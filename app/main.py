from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any, Optional

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import settings
from app.deps import get_store, invalidate_store_cache, require_secret
from app.llm import embed_texts
from app.rag.file_extract import extract_text
from app.rag.ingest import run_ingest
from app.rag.jd_history import delete_entry, get_entry, list_entries, upsert_entry
from app.rag.retrieve import hybrid_retrieve
from app.rag.store import VectorStore
from app.services import qa_flow

_UPLOADED_RESUME = "resume_facts_uploaded.md"
_MAX_UPLOAD_MB = 20


class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=8000)
    doc_type: Optional[str] = Field(
        default=None, description="study | resume | null=全部"
    )
    show_chunks: bool = False


class JDBody(BaseModel):
    jd_text: str = Field(..., min_length=20, max_length=50000)
    company: str = Field(default="", max_length=100)
    position: str = Field(default="", max_length=100)
    entry_id: Optional[str] = Field(default=None, description="传入已有 ID 则视为重新匹配")


class InterviewBody(BaseModel):
    focus: str = Field(default="", max_length=500)
    count: int = Field(default=8, ge=3, le=20)


class IngestBody(BaseModel):
    reset: bool = False


def _truncate(s: str, n: int = 6000) -> str:
    return s if len(s) <= n else s[:n]


app = FastAPI(title="FindAIJob — AI 简历问答助手", version="0.1.0")

repo_static = Path(__file__).resolve().parent.parent / "static"
if repo_static.is_dir():
    app.mount("/static", StaticFiles(directory=str(repo_static)), name="static")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def index() -> FileResponse:
    index_path = repo_static / "index.html"
    if not index_path.is_file():
        raise HTTPException(404, "static/index.html missing")
    return FileResponse(index_path)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/ask")
async def api_ask(
    body: AskBody,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    q_emb = (await embed_texts([body.question]))[0]
    hits = await hybrid_retrieve(
        store,
        body.question,
        q_emb,
        doc_type_filter=body.doc_type or None,
    )
    answer, citations = await qa_flow.answer_question(body.question, hits)
    out: dict[str, Any] = {"answer": answer, "citations": citations}
    if body.show_chunks:
        out["chunks"] = [
            {
                "chunk_id": h.cid,
                "source_path": h.source_path,
                "heading_path": h.heading_path,
                "doc_type": h.doc_type,
                "snippet": h.text[:500],
            }
            for h in hits
        ]
    return out


@app.post("/api/jd-match")
async def api_jd(
    body: JDBody,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    jd_head = _truncate(body.jd_text, 8000)
    q_emb = (await embed_texts([jd_head]))[0]
    hits = await hybrid_retrieve(
        store,
        jd_head,
        q_emb,
        top_k=settings.retrieve_top_k + 4,
        doc_type_filter=None,
    )
    resume_hits = [h for h in hits if h.doc_type == "resume"]
    if resume_hits:
        hits = resume_hits[: settings.retrieve_top_k] + [
            h for h in hits if h.doc_type != "resume"
        ][:6]
    else:
        hits = hits[: settings.retrieve_top_k + 2]
    result, citations = await qa_flow.analyze_jd(body.jd_text, hits)
    entry = upsert_entry(
        company=body.company.strip(),
        position=body.position.strip(),
        jd_text=body.jd_text,
        analysis=result,
        citations_count=len(citations),
        entry_id=body.entry_id,
    )
    return {"analysis": result, "citations": citations, "entry_id": entry["id"]}


@app.get("/api/jd-history")
async def api_jd_history(
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    return list_entries()


@app.get("/api/jd-history/{entry_id}")
async def api_jd_history_entry(
    entry_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    e = get_entry(entry_id)
    if not e:
        raise HTTPException(404, "记录不存在")
    return e


@app.delete("/api/jd-history/{entry_id}")
async def api_jd_history_delete(
    entry_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not delete_entry(entry_id):
        raise HTTPException(404, "记录不存在")
    return {"deleted": True}


@app.post("/api/interview-questions")
async def api_interview(
    body: InterviewBody,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    fq = body.focus.strip() or "综合技术栈与项目经历"
    mix = f"{fq} 简历 面试 深度学习 工程化 业务落地"
    q_emb = (await embed_texts([mix]))[0]
    hits = await hybrid_retrieve(store, mix, q_emb, top_k=settings.retrieve_top_k + 2)
    result, citations = await qa_flow.generate_interview_questions(
        body.focus, body.count, hits
    )
    return {"result": result, "citations": citations}


@app.get("/api/resume-info")
async def api_resume_info(
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    dest = settings.knowledge_root.resolve() / "profile" / _UPLOADED_RESUME
    if not dest.is_file():
        return {"exists": False}

    first_line = dest.read_text(encoding="utf-8").splitlines()[0]
    filename = first_line.removeprefix("# 简历（上传自 ").removesuffix("）").strip()
    modified_at = dest.stat().st_mtime

    try:
        total = store.collection.count()
    except Exception:
        total = 0

    return {
        "exists": True,
        "filename": filename,
        "modified_at": modified_at,
        "chunk_count": total,
    }


@app.post("/api/upload-resume")
async def api_upload_resume(
    file: Annotated[UploadFile, File(description="PDF 或 DOCX 格式的简历文件")],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    filename = file.filename or "resume"
    size_limit = _MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(size_limit + 1)
    if len(data) > size_limit:
        raise HTTPException(413, f"文件过大，最大支持 {_MAX_UPLOAD_MB} MB")

    try:
        text = extract_text(filename, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(422, f"文件解析失败：{e}")

    if not text.strip():
        raise HTTPException(422, "未能从文件中提取到文字，请确认文件内容不为空")

    profile_dir = settings.knowledge_root.resolve() / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    dest = profile_dir / _UPLOADED_RESUME
    dest.write_text(f"# 简历（上传自 {filename}）\n\n{text}", encoding="utf-8")

    n, logs = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"filename": filename, "chunk_count": n, "logs": logs}


@app.post("/api/admin/ingest")
async def api_ingest(
    body: IngestBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    n, logs = await run_ingest(reset=body.reset)
    invalidate_store_cache()
    return {"chunk_count": n, "logs": logs}
