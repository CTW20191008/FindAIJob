from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any, Optional

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import settings
from app.deps import get_store, invalidate_store_cache, require_secret
from app.llm import embed_texts
from app.rag.file_extract import extract_text
from app.rag.ingest import run_ingest
from app.rag.jd_catalog import (
    create_entry as catalog_create,
    delete_entry as catalog_delete,
    get_entry as catalog_get,
    list_entries as catalog_list,
    migrate_from_history as catalog_migrate,
    update_entry as catalog_update,
)
from app.rag.jd_history import (
    delete_analysis,
    delete_for_jd,
    get_analysis,
    is_old_format,
    list_for_jd,
    migrate_to_new_format,
    set_question_bank,
    upsert_analysis,
)
from app.rag.retrieve import hybrid_retrieve
from app.rag.store import VectorStore
from app.services import qa_flow

_MAX_UPLOAD_MB = 20
_NOTES_DIR_NAME = "notes"  # docs/notes/ → doc_type=study
# resume files: profile/resume_facts_{ts}_{title}.md → doc_type=resume via RESUME_FACTS in path


class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=8000)
    doc_type: Optional[str] = Field(
        default=None, description="study | resume | question_bank | null=全部"
    )
    jd_entry_id: Optional[str] = Field(default=None, description="限定题库来源的 JD entry id")
    show_chunks: bool = False


class JDCatalogBody(BaseModel):
    company: str = Field(..., min_length=1, max_length=100)
    position: str = Field(..., min_length=1, max_length=100)
    jd_text: str = Field(..., min_length=20, max_length=50000)


class JDCatalogUpdateBody(BaseModel):
    company: Optional[str] = Field(default=None, max_length=100)
    position: Optional[str] = Field(default=None, max_length=100)
    jd_text: Optional[str] = Field(default=None, max_length=50000)


class JDMatchBody(BaseModel):
    jd_id: str
    resume_filename: Optional[str] = Field(default=None)
    analysis_id: Optional[str] = Field(default=None, description="传入已有分析 ID 则视为更新")


class InterviewBody(BaseModel):
    focus: str = Field(default="", max_length=500)
    count: int = Field(default=8, ge=1, le=20)
    jd_entry_id: Optional[str] = Field(default=None, description="限定从指定 JD 题库检索")


class CompareBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    user_answer: str = Field(default="", max_length=10000)
    hint: str = Field(default="", max_length=5000)


class NoteBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=10, max_length=200000)


class IngestBody(BaseModel):
    reset: bool = False


def _truncate(s: str, n: int = 6000) -> str:
    return s if len(s) <= n else s[:n]


app = FastAPI(title="FindAIJob — AI 简历问答助手", version="0.1.0")


@app.on_event("startup")
async def _on_startup() -> None:
    from datetime import datetime
    from app.rag.jd_history import _load as _hist_load

    # 1. Migrate legacy resume file（文件名不再用字面量 uploaded，尽量从 Markdown 标题推断）
    old_resume = settings.knowledge_root.resolve() / "profile" / "resume_facts_uploaded.md"
    if old_resume.is_file():
        ts = datetime.fromtimestamp(old_resume.stat().st_mtime).strftime("%Y%m%d_%H%M%S")
        stem = _migrate_legacy_resume_stem(old_resume)
        new_path = old_resume.parent / f"resume_facts_{ts}_{stem}.md"
        if not new_path.exists():
            old_resume.rename(new_path)

    # 2. Migrate old jd_history.json (combined format → separate catalog+history)
    old_hist = _hist_load()
    if is_old_format(old_hist):
        id_map = catalog_migrate(old_hist)
        migrate_to_new_format(old_hist, id_map)

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
        jd_entry_id_filter=body.jd_entry_id or None,
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


# ── JD Catalog ─────────────────────────────────────────────────────────────

@app.get("/api/jd-catalog")
async def api_jd_catalog_list(
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    catalog = catalog_list()
    # Attach analysis summary for each JD
    result = []
    for jd in catalog:
        analyses = list_for_jd(jd["id"])
        result.append({**jd, "analysis_count": len(analyses)})
    return result


@app.post("/api/jd-catalog")
async def api_jd_catalog_create(
    body: JDCatalogBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    return catalog_create(
        company=body.company.strip(),
        position=body.position.strip(),
        jd_text=body.jd_text,
    )


@app.get("/api/jd-catalog/{jd_id}")
async def api_jd_catalog_get(
    jd_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    e = catalog_get(jd_id)
    if not e:
        raise HTTPException(404, "JD 不存在")
    return e


@app.put("/api/jd-catalog/{jd_id}")
async def api_jd_catalog_update(
    jd_id: str,
    body: JDCatalogUpdateBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    e = catalog_update(jd_id, company=body.company, position=body.position, jd_text=body.jd_text)
    if not e:
        raise HTTPException(404, "JD 不存在")
    return e


@app.delete("/api/jd-catalog/{jd_id}")
async def api_jd_catalog_delete(
    jd_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not catalog_delete(jd_id):
        raise HTTPException(404, "JD 不存在")
    delete_for_jd(jd_id)
    return {"deleted": True}


# ── JD Match & Analysis History ────────────────────────────────────────────

@app.get("/api/jd-catalog/{jd_id}/analyses")
async def api_jd_analyses_list(
    jd_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    return list_for_jd(jd_id)


@app.post("/api/jd-match")
async def api_jd(
    body: JDMatchBody,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    jd = catalog_get(body.jd_id)
    if not jd:
        raise HTTPException(404, "JD 不存在，请先在 JD 库中添加")

    jd_text = jd["jd_text"]
    jd_head = _truncate(jd_text, 8000)
    q_emb = (await embed_texts([jd_head]))[0]
    hits = await hybrid_retrieve(store, jd_head, q_emb, top_k=settings.retrieve_top_k + 4)
    resume_hits = [h for h in hits if h.doc_type == "resume"]
    if body.resume_filename:
        selected = [h for h in resume_hits if body.resume_filename in h.source_path]
        resume_hits = selected if selected else resume_hits
    hits = (resume_hits[:settings.retrieve_top_k] + [h for h in hits if h.doc_type != "resume"][:6]) \
        if resume_hits else hits[:settings.retrieve_top_k + 2]

    result, citations = await qa_flow.analyze_jd(jd_text, hits)
    analysis = upsert_analysis(
        jd_id=body.jd_id,
        resume_filename=body.resume_filename or "",
        analysis=result,
        citations_count=len(citations),
        analysis_id=body.analysis_id,
    )
    return {"analysis": result, "citations": citations, "analysis_id": analysis["id"], "jd_id": body.jd_id}


@app.get("/api/jd-history/{analysis_id}")
async def api_analysis_get(
    analysis_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    e = get_analysis(analysis_id)
    if not e:
        raise HTTPException(404, "分析记录不存在")
    jd = catalog_get(e.get("jd_id", "")) or {}
    return {**e, "company": jd.get("company", ""), "position": jd.get("position", ""), "jd_text": jd.get("jd_text", "")}


@app.delete("/api/jd-history/{analysis_id}")
async def api_analysis_delete(
    analysis_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not delete_analysis(analysis_id):
        raise HTTPException(404, "分析记录不存在")
    return {"deleted": True}


@app.post("/api/jd-history/{analysis_id}/question-bank")
async def api_generate_question_bank(
    analysis_id: str,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    from datetime import datetime, timezone
    from app.services.qa_flow import generate_question_bank, question_bank_to_markdown

    analysis = get_analysis(analysis_id)
    if not analysis:
        raise HTTPException(404, "分析记录不存在")
    jd = catalog_get(analysis.get("jd_id", ""))
    if not jd:
        raise HTTPException(404, "关联 JD 不存在")

    jd_text = jd["jd_text"]
    company = jd.get("company", "未知公司")
    position = jd.get("position", "未知岗位")

    mix = f"{company} {position} {jd_text[:500]}"
    q_emb = (await embed_texts([mix]))[0]
    resume_fn = analysis.get("resume_filename", "")
    hits = await hybrid_retrieve(store, mix, q_emb, top_k=settings.retrieve_top_k + 4, doc_type_filter="resume")
    if resume_fn:
        sel = [h for h in hits if resume_fn in h.source_path]
        if sel:
            hits = sel
    if not hits:
        hits = await hybrid_retrieve(store, mix, q_emb, top_k=settings.retrieve_top_k)

    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")
    qb_data = await generate_question_bank(jd_text, company, position, hits)
    md_content = question_bank_to_markdown(qb_data, company, position, analysis_id, generated_at)

    qb_dir = settings.knowledge_root.resolve() / "docs" / "question_banks"
    qb_dir.mkdir(parents=True, exist_ok=True)
    (qb_dir / f"{analysis_id}.md").write_text(md_content, encoding="utf-8")

    n, _ = await run_ingest(reset=False)
    invalidate_store_cache()
    category_names = [c.get("name", "") for c in qb_data.get("categories", []) if c.get("name")]
    set_question_bank(analysis_id, True, categories=category_names)

    total_q = sum(len(c.get("questions", [])) for c in qb_data.get("categories", []))
    return {
        "analysis_id": analysis_id,
        "question_count": total_q,
        "chunk_count": n,
        "categories": category_names,
    }


@app.post("/api/interview-questions")
async def api_interview(
    body: InterviewBody,
    store: Annotated[VectorStore, Depends(get_store)],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    fq = body.focus.strip() or "综合技术栈与项目经历"
    mix = f"{fq} 简历 面试 深度学习 工程化 业务落地"
    q_emb = (await embed_texts([mix]))[0]
    hits = await hybrid_retrieve(
        store, mix, q_emb,
        top_k=settings.retrieve_top_k + 2,
        jd_entry_id_filter=body.jd_entry_id or None,
    )
    result, citations = await qa_flow.generate_interview_questions(
        body.focus, body.count, hits
    )
    return {"result": result, "citations": citations}


def _profile_dir() -> Path:
    d = settings.knowledge_root.resolve() / "profile"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _resume_safe_stem(name: str) -> str:
    import re
    s = re.sub(r'[\\/:*?"<>|]', "_", name.strip())
    return s[:60] or "resume"


def _migrate_legacy_resume_stem(legacy_path: Path) -> str:
    """从旧版 resume_facts_uploaded.md 推断重命名后缀，避免出现无意义的 `_uploaded`。"""
    import re
    try:
        txt = legacy_path.read_text(encoding="utf-8")
        first = txt.splitlines()[0].lstrip("# ").strip() if txt else ""
        if first:
            m = re.match(r"^简历[（(](.+)[）)]\s*$", first)
            cand = (m.group(1).strip() if m else first.strip())
            if cand and cand.lower() != "uploaded":
                return _resume_safe_stem(cand)
    except Exception:
        pass
    return _resume_safe_stem("本地导入")


def _resume_filename(label: str) -> str:
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"resume_facts_{ts}_{_resume_safe_stem(label)}.md"


def _list_resume_files() -> list[Path]:
    pd = _profile_dir()
    return sorted(
        [p for p in pd.glob("resume_facts_*.md") if p.is_file()],
        key=lambda p: p.stat().st_mtime, reverse=True,
    )


def _read_resume_parts(path: Path) -> tuple[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    title = lines[0].lstrip("# ").strip() if lines else ""
    content = "\n".join(lines[2:]).strip() if len(lines) > 2 else ""
    return title, content


@app.get("/api/resumes")
async def api_resumes_list(
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    return [
        {
            "filename": p.name,
            "title": _read_resume_parts(p)[0],
            "modified_at": p.stat().st_mtime,
            "size": p.stat().st_size,
        }
        for p in _list_resume_files()
    ]


@app.get("/api/resumes/{filename}")
async def api_resume_get(
    filename: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _profile_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "简历文件不存在")
    title, content = _read_resume_parts(target)
    return {"filename": filename, "title": title, "content": content}


class ResumeUpdateBody(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = Field(..., min_length=10, max_length=200000)


@app.put("/api/resumes/{filename}")
async def api_resume_put(
    filename: str,
    body: ResumeUpdateBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _profile_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "简历文件不存在")
    title_line = f"# {body.title}" if body.title.strip() else target.read_text(encoding="utf-8").splitlines()[0]
    target.write_text(f"{title_line}\n\n{body.content.strip()}", encoding="utf-8")
    n, _ = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"chunk_count": n}


@app.delete("/api/resumes/{filename}")
async def api_resume_delete(
    filename: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _profile_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "简历文件不存在")
    target.unlink()
    n, _ = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"deleted": True, "chunk_count": n}


@app.post("/api/upload-resume")
async def api_upload_resume(
    file: Annotated[UploadFile, File(description="PDF 或 DOCX 格式的简历文件")],
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    original_name = file.filename or "resume"
    size_limit = _MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(size_limit + 1)
    if len(data) > size_limit:
        raise HTTPException(413, f"文件过大，最大支持 {_MAX_UPLOAD_MB} MB")

    try:
        text = extract_text(original_name, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(422, f"文件解析失败：{e}")

    if not text.strip():
        raise HTTPException(422, "未能从文件中提取到文字，请确认文件内容不为空")

    saved_name = _resume_filename(Path(original_name).stem)
    dest = _profile_dir() / saved_name
    dest.write_text(f"# 简历（{Path(original_name).stem}）\n\n{text}", encoding="utf-8")

    n, _ = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"filename": saved_name, "original": original_name, "chunk_count": n}


@app.post("/api/answer-compare")
async def api_answer_compare(
    body: CompareBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    from app.services.qa_flow import compare_answer
    result = await compare_answer(body.question, body.user_answer, body.hint)
    return result


def _notes_dir() -> Path:
    d = settings.knowledge_root.resolve() / "docs" / _NOTES_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_stem(title: str) -> str:
    import re
    s = re.sub(r'[\\/:*?"<>|]', "_", title.strip())
    return s[:80] or "note"


def _note_filename(title: str) -> str:
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{ts}_{_safe_stem(title)}.md"


@app.get("/api/notes")
async def api_notes_list(
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    nd = _notes_dir()
    result = []
    for f in sorted(nd.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
        first_line = f.read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip()
        result.append({
            "filename": f.name,
            "title": first_line,
            "size": f.stat().st_size,
            "modified_at": f.stat().st_mtime,
        })
    return result


@app.post("/api/notes")
async def api_notes_save(
    body: NoteBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    nd = _notes_dir()
    fname = _note_filename(body.title)
    (nd / fname).write_text(
        f"# {body.title}\n\n{body.content}", encoding="utf-8"
    )
    n, logs = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"filename": fname, "chunk_count": n}


@app.post("/api/notes/upload")
async def api_notes_upload(
    file: Annotated[UploadFile, File()],
    _: Annotated[None, Depends(require_secret)],
    title: str = Form(default=""),
) -> dict[str, Any]:
    filename = file.filename or "note"
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
        raise HTTPException(422, "未能从文件中提取到文字")

    nd = _notes_dir()
    note_title = title.strip() or Path(filename).stem
    fname = _note_filename(note_title)
    (nd / fname).write_text(f"# {note_title}\n\n{text}", encoding="utf-8")
    n, logs = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"filename": fname, "chunk_count": n}


@app.get("/api/notes/{filename}")
async def api_note_get(
    filename: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _notes_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "笔记不存在")
    lines = target.read_text(encoding="utf-8").splitlines()
    title = lines[0].lstrip("# ").strip() if lines else ""
    content = "\n".join(lines[2:]).strip() if len(lines) > 2 else ""
    return {"filename": filename, "title": title, "content": content}


class NoteUpdateBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=200000)


@app.put("/api/notes/{filename}")
async def api_note_put(
    filename: str,
    body: NoteUpdateBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _notes_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "笔记不存在")
    target.write_text(f"# {body.title}\n\n{body.content.strip()}", encoding="utf-8")
    n, logs = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"chunk_count": n}


@app.delete("/api/notes/{filename}")
async def api_notes_delete(
    filename: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(400, "无效文件名")
    target = _notes_dir() / filename
    if not target.is_file():
        raise HTTPException(404, "笔记不存在")
    target.unlink()
    n, logs = await run_ingest(reset=False)
    invalidate_store_cache()
    return {"deleted": True, "chunk_count": n}


@app.post("/api/admin/ingest")
async def api_ingest(
    body: IngestBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    n, logs = await run_ingest(reset=body.reset)
    invalidate_store_cache()
    return {"chunk_count": n, "logs": logs}
