from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.deps import require_secret
from app.job_track import repo
from app.job_track.constants import (
    FEEDBACK_SOURCES,
    FEEDBACK_TYPES,
    PIPELINE_STAGES,
    POSITION_DIRECTIONS,
    QUESTION_CATEGORIES,
    SUGGESTED_PLATFORMS,
    STAGE_OUTCOMES,
)
from app.job_track.schemas import (
    AI_COACH_DEFAULT_FOCUS,
    AiCoachBody,
    ApplicationCreate,
    ApplicationPatch,
    FeedbackCreate,
    FeedbackPatch,
    InterviewCreate,
    InterviewPatch,
    StageOutcomePatch,
    direction_ok,
    patch_to_dict,
)
from app.job_track.stats import aggregate_stats
from app.llm import chat_complete, safe_json_extract
from app.rag.jd_history import get_analysis

router = APIRouter(prefix="/api/job-track", tags=["job-track"])


@router.get("/meta")
async def job_track_meta(_: Annotated[None, Depends(require_secret)]) -> dict[str, Any]:
    stages = [
        {"id": s, "labels": {"pending": "待定", "passed": "通过", "failed": "未通过"}}
        for s in PIPELINE_STAGES
    ]
    return {
        "pipeline_stages": stages,
        "position_directions": list(POSITION_DIRECTIONS),
        "suggested_platforms": list(SUGGESTED_PLATFORMS),
        "feedback_sources": list(FEEDBACK_SOURCES),
        "feedback_types": list(FEEDBACK_TYPES),
        "question_categories": list(QUESTION_CATEGORIES),
        "stage_outcomes": list(STAGE_OUTCOMES),
    }


@router.get("/applications")
async def list_applications(
    _: Annotated[None, Depends(require_secret)],
    from_date: str | None = None,
    to_date: str | None = None,
    days: int | None = None,
    direction: str | None = None,
    resume_filename: str | None = None,
) -> list[dict[str, Any]]:
    d_from, d_to = repo.resolve_date_window(days=days, from_date=from_date, to_date=to_date)
    return repo.list_applications(
        applied_from=d_from,
        applied_to=d_to,
        direction=direction,
        resume_filename=resume_filename,
    )


@router.post("/applications", status_code=201)
async def create_application(
    body: ApplicationCreate,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not direction_ok(body.direction):
        raise HTTPException(400, f"岗位方向须为预置枚举之一：{', '.join(POSITION_DIRECTIONS)}")
    try:
        return repo.create_application(
            company=body.company,
            position=body.position,
            direction=body.direction,
            applied_on=body.applied_on,
            platform=body.platform,
            location=body.location,
            salary_range=body.salary_range,
            resume_filename=body.resume_filename,
            jd_catalog_id=body.jd_catalog_id,
            jd_text=body.jd_text,
            jd_keywords=body.jd_keywords,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except repo.DuplicateApplicationError as e:
        raise HTTPException(409, str(e)) from e


def _detail(application_id: str) -> dict[str, Any]:
    conn = repo.get_connection()
    try:
        out = repo.application_detail(conn, application_id)
    finally:
        conn.close()
    if not out:
        raise HTTPException(404, "投递记录不存在")
    return out


@router.get("/applications/{application_id}")
async def get_application(
    application_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    return _detail(application_id)


@router.patch("/applications/{application_id}")
async def patch_application(
    application_id: str,
    body: ApplicationPatch,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    data = patch_to_dict(body)
    if "direction" in data and not direction_ok(data["direction"]):
        raise HTTPException(400, "岗位方向不正确")
    try:
        out = repo.patch_application(application_id, data)
    except repo.DuplicateApplicationError as e:
        raise HTTPException(409, str(e)) from e
    if not out:
        raise HTTPException(404, "投递记录不存在")
    return out


@router.delete("/applications/{application_id}")
async def delete_application(
    application_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not repo.delete_application(application_id):
        raise HTTPException(404, "投递记录不存在")
    return {"deleted": True}


@router.patch("/applications/{application_id}/stages/{stage}")
async def patch_stage_outcome(
    application_id: str,
    stage: str,
    body: StageOutcomePatch,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if body.outcome not in STAGE_OUTCOMES:
        raise HTTPException(400, "outcome 无效")
    try:
        out = repo.set_stage_outcome(application_id, stage, body.outcome)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if not out:
        raise HTTPException(404, "投递记录不存在")
    return out


@router.post("/applications/{application_id}/jd-keywords-draft")
async def jd_keywords_draft(
    application_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    conn = repo.get_connection()
    try:
        row = conn.execute(
            """SELECT jd_text, jd_keywords_user_edited FROM applications WHERE id = ?""",
            (application_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "投递记录不存在")
    if row["jd_keywords_user_edited"]:
        raise HTTPException(400, "JD 关键词已由用户编辑，不再自动生成")
    jd_text = (row["jd_text"] or "").strip()[:8000]
    if not jd_text:
        raise HTTPException(400, "请先填写 JD 原文后再生成关键词")
    if not settings.openai_api_key:
        raise HTTPException(503, "未配置 OPENAI_API_KEY，无法生成")
    prompt = (
        "从以下 JD 中提取 8–15 个中文关键词（短语），用于简历匹配。"
        '只输出 JSON：{"keywords":["..."]}，不要其它文字。\n\nJD：\n' + jd_text
    )
    raw = await chat_complete(
        [
            {"role": "system", "content": "只输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=500,
    )
    data = safe_json_extract(raw)
    kws = data.get("keywords")
    if not isinstance(kws, list):
        kws = [str(data)]
    text = ", ".join(str(x).strip() for x in kws if str(x).strip())
    out = repo.set_jd_keywords_from_ai(application_id, text)
    if not out:
        raise HTTPException(404, "投递记录不存在")
    return out


@router.get("/applications/{application_id}/feedbacks")
async def list_feedbacks_route(
    application_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> list[dict[str, Any]]:
    _detail(application_id)
    return repo.list_feedbacks(application_id)


@router.post("/applications/{application_id}/feedbacks", status_code=201)
async def create_feedback_route(
    application_id: str,
    body: FeedbackCreate,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    _detail(application_id)
    try:
        return repo.create_feedback(
            application_id,
            {
                "source": body.source,
                "happened_at": body.happened_at,
                "content": body.content,
                "feedback_type": body.feedback_type,
                "trustworthy": body.trustworthy,
                "next_action": body.next_action or "",
            },
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.patch("/feedbacks/{feedback_id}")
async def patch_feedback_route(
    feedback_id: str,
    body: FeedbackPatch,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    out = repo.patch_feedback(feedback_id, data)
    if not out:
        raise HTTPException(404, "反馈不存在")
    return out


@router.delete("/feedbacks/{feedback_id}")
async def delete_feedback_route(
    feedback_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not repo.delete_feedback(feedback_id):
        raise HTTPException(404, "反馈不存在")
    return {"deleted": True}


@router.get("/interviews")
async def list_interviews_route(
    _: Annotated[None, Depends(require_secret)],
    application_id: str | None = None,
) -> list[dict[str, Any]]:
    return repo.list_interviews(application_id)


@router.post("/interviews", status_code=201)
async def create_interview_route(
    body: InterviewCreate,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    try:
        return repo.create_interview(
            {
                "application_id": body.application_id,
                "stage": body.stage,
                "interview_on": body.interview_on,
                "duration_min": body.duration_min,
                "interviewer_type": body.interviewer_type,
                "questions": [q.model_dump() for q in body.questions],
                "result": body.result,
                "failure_guess": body.failure_guess,
                "improvements": body.improvements,
            }
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/interviews/{session_id}")
async def get_interview_route(
    session_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    out = repo.get_interview(session_id)
    if not out:
        raise HTTPException(404, "复盘记录不存在")
    return out


@router.patch("/interviews/{session_id}")
async def patch_interview_route(
    session_id: str,
    body: InterviewPatch,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    try:
        out = repo.patch_interview(session_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if not out:
        raise HTTPException(404, "复盘记录不存在")
    return out


@router.delete("/interviews/{session_id}")
async def delete_interview_route(
    session_id: str,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not repo.delete_interview(session_id):
        raise HTTPException(404, "复盘记录不存在")
    return {"deleted": True}


@router.get("/stats")
async def job_track_stats(
    _: Annotated[None, Depends(require_secret)],
    from_date: str | None = None,
    to_date: str | None = None,
    days: int | None = None,
    resume_filename: str | None = None,
) -> dict[str, Any]:
    d_from, d_to = repo.resolve_date_window(days=days, from_date=from_date, to_date=to_date)
    rf = (resume_filename or "").strip() or None
    return aggregate_stats(d_from, d_to, resume_filename=rf)


@router.post("/ai/coach")
async def ai_coach(
    body: AiCoachBody,
    _: Annotated[None, Depends(require_secret)],
) -> dict[str, Any]:
    if not settings.openai_api_key:
        raise HTTPException(503, "未配置 OPENAI_API_KEY")
    d_from, d_to = repo.resolve_date_window(days=body.days, from_date=None, to_date=None)
    rf_clean = body.resume_filename.strip() or None
    stats = aggregate_stats(d_from, d_to, resume_filename=rf_clean)
    apps = repo.list_applications(applied_from=d_from, applied_to=d_to, resume_filename=rf_clean)

    jd_extra = ""
    jaid_saved: str | None = None
    if body.jd_analysis_id:
        jid = body.jd_analysis_id.strip()
        if not jid:
            raise HTTPException(400, "jd_analysis_id 无效")
        hist = get_analysis(jid)
        if not hist:
            raise HTTPException(400, "jd_analysis_id 不存在")
        jd_extra = json.dumps(
            {
                "analysis_id": jid,
                "jd_id": hist.get("jd_id"),
                "resume_filename": hist.get("resume_filename"),
                "matched_at": hist.get("matched_at"),
                "analysis": hist.get("analysis"),
            },
            ensure_ascii=False,
        )[:8000]
        jaid_saved = jid

    focus_eff = (body.focus or "").strip() or AI_COACH_DEFAULT_FOCUS
    lines = [
        f"时间窗：{d_from} ~ {d_to}，侧重：{focus_eff}",
        f"投递维度·简历文件名：{(rf_clean or '（未限定——时间窗内全部投递）')}",
        "统计（勿编造数字，仅解释以下结果）：",
        json.dumps(stats, ensure_ascii=False),
        f"样例投递条数：{len(apps)}，请结合环节三态与放弃策略给建议。",
    ]
    if jd_extra:
        lines.append("以下为一条「JD 对标分析」（jd_history）快照节选，可作补充上下文：")
        lines.append(jd_extra)

    text = await chat_complete(
        [
            {
                "role": "system",
                "content": "你是求职教练。必须基于用户提供的统计 JSON 给建议，不要编造百分比；用中文 Markdown 分节输出。",
            },
            {"role": "user", "content": "\n\n".join(lines)},
        ],
        temperature=0.4,
        max_tokens=2500,
    )
    snap = repo.insert_ai_coach_snapshot(
        resume_filename=rf_clean or "",
        jd_analysis_id=jaid_saved,
        days=body.days,
        focus=focus_eff,
        applied_from=d_from,
        applied_to=d_to,
        markdown=text,
    )
    return {
        "found": True,
        "markdown": text,
        "window": {"from": d_from, "to": d_to},
        "days": body.days,
        "focus": focus_eff,
        "id": snap["id"],
        "resume_filename": snap.get("resume_filename") or "",
        "jd_analysis_id": snap.get("jd_analysis_id"),
        "analyzed_at": snap["created_at"],
    }


@router.get("/ai/coach/latest")
async def ai_coach_latest(
    _: Annotated[None, Depends(require_secret)],
    days: Annotated[int, Query(ge=1, le=366)] = 30,
    resume_filename: str = "",
    focus: Annotated[str, Query(max_length=200)] = AI_COACH_DEFAULT_FOCUS,
) -> dict[str, Any]:
    fc = focus.strip() or AI_COACH_DEFAULT_FOCUS
    row = repo.latest_ai_coach_snapshot(
        days=days,
        focus=fc,
        resume_filename=resume_filename.strip(),
    )
    if not row:
        return {"found": False}
    return {
        "found": True,
        "markdown": row["markdown"],
        "window": {"from": row["applied_from"], "to": row["applied_to"]},
        "days": row["days"],
        "focus": row["focus"],
        "id": row["id"],
        "resume_filename": row.get("resume_filename") or "",
        "jd_analysis_id": row.get("jd_analysis_id"),
        "analyzed_at": row["created_at"],
    }