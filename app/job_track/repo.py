from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.job_track.constants import (
    OUTCOME_FAILED,
    OUTCOME_PASSED,
    OUTCOME_PENDING,
    PIPELINE_STAGES,
)
from app.job_track.db import get_connection
from app.job_track.normalize import company_position_norm


class DuplicateApplicationError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def stage_index(stage: str) -> int:
    try:
        return PIPELINE_STAGES.index(stage)
    except ValueError as e:
        raise ValueError(f"未知环节：{stage}") from e


def _row_application(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["abandoned"] = bool(d.get("abandoned"))
    d["jd_keywords_user_edited"] = bool(d.get("jd_keywords_user_edited"))
    return d


def _load_stages(conn: sqlite3.Connection, application_id: str) -> list[dict[str, Any]]:
    cur = conn.execute(
        """SELECT stage, outcome, updated_at FROM application_stages WHERE application_id = ?""",
        (application_id,),
    )
    rows = [dict(zip(["stage", "outcome", "updated_at"], row)) for row in cur.fetchall()]

    def sort_key(row: dict[str, Any]) -> int:
        try:
            return PIPELINE_STAGES.index(row["stage"])
        except ValueError:
            return 999

    rows.sort(key=sort_key)
    return rows


def application_detail(conn: sqlite3.Connection, app_id: str) -> Optional[dict[str, Any]]:
    cur = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,))
    row = cur.fetchone()
    if not row:
        return None
    out = _row_application(row)
    out["stages"] = _load_stages(conn, app_id)
    return out


def list_applications(
    *,
    applied_from: Optional[str] = None,
    applied_to: Optional[str] = None,
    direction: Optional[str] = None,
    resume_filename: Optional[str] = None,
) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        parts = ["SELECT * FROM applications WHERE 1=1"]
        args: list[Any] = []
        if applied_from:
            parts.append("AND applied_on >= ?")
            args.append(applied_from)
        if applied_to:
            parts.append("AND applied_on <= ?")
            args.append(applied_to)
        if direction:
            parts.append("AND direction = ?")
            args.append(direction)
        if resume_filename:
            parts.append("AND resume_filename = ?")
            args.append(resume_filename)
        parts.append("ORDER BY applied_on DESC, created_at DESC")
        cur = conn.execute(" ".join(parts), args)
        result = []
        for row in cur.fetchall():
            d = _row_application(row)
            d["stages"] = _load_stages(conn, d["id"])
            result.append(d)
        return result
    finally:
        conn.close()


def create_application(
    *,
    company: str,
    position: str,
    direction: str,
    applied_on: str,
    platform: str = "",
    location: str = "",
    salary_range: str = "",
    resume_filename: str = "",
    jd_catalog_id: Optional[str] = None,
    jd_text: str = "",
    jd_keywords: str = "",
    notes: str = "",
) -> dict[str, Any]:
    cn, pn = company_position_norm(company, position)
    if not cn or not pn:
        raise ValueError("公司与岗位不能为空")
    uk = jd_keywords.strip()
    ue = 1 if uk else 0
    app_id = str(uuid.uuid4())
    ts = now_iso()
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO applications (
              id, company, position, company_norm, position_norm,
              direction, platform, applied_on,
              location, salary_range, resume_filename,
              jd_catalog_id, jd_text, jd_keywords, jd_keywords_user_edited,
              notes, abandoned, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                app_id,
                company.strip(),
                position.strip(),
                cn,
                pn,
                direction,
                platform.strip(),
                applied_on,
                location.strip(),
                salary_range.strip(),
                resume_filename.strip(),
                jd_catalog_id.strip() if jd_catalog_id else None,
                jd_text,
                uk,
                ue,
                notes.strip(),
                0,
                ts,
                ts,
            ),
        )
        conn.execute(
            """INSERT INTO application_stages (application_id, stage, outcome, updated_at)
               VALUES (?, ?, ?, ?)""",
            (app_id, PIPELINE_STAGES[0], OUTCOME_PENDING, ts),
        )
        conn.commit()
        return application_detail(conn, app_id)  # type: ignore[arg-type]
    except sqlite3.IntegrityError:
        conn.rollback()
        raise DuplicateApplicationError("公司已存在同名岗位投递记录，请修改岗位名称以区分（如后缀 岗位1）")
    finally:
        conn.close()


def delete_application(application_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM applications WHERE id = ?", (application_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _unique_conflict_on_update(conn: sqlite3.Connection, aid: str, company: str, position: str) -> None:
    cn, pn = company_position_norm(company, position)
    cur = conn.execute(
        "SELECT id FROM applications WHERE company_norm = ? AND position_norm = ? AND id != ?",
        (cn, pn, aid),
    )
    if cur.fetchone():
        raise DuplicateApplicationError("公司已存在同名岗位投递记录，请修改岗位名称以区分")


def patch_application(application_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    """可更新除 id 以外的业务字段；含 jd_keywords 时视为用户手改并重置草稿生成条件。"""
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM applications WHERE id = ?", (application_id,))
        row = cur.fetchone()
        if not row:
            return None

        ts = now_iso()
        cols = dict(row)
        nc = cols["company"]
        np = cols["position"]
        if "company" in fields:
            nc = str(fields["company"]).strip()
        if "position" in fields:
            np = str(fields["position"]).strip()

        if "company" in fields or "position" in fields:
            _unique_conflict_on_update(conn, application_id, nc, np)

        assignments: list[str] = []
        args: list[Any] = []

        def add(column: str, value: Any) -> None:
            assignments.append(f"{column} = ?")
            args.append(value)

        if "company" in fields or "position" in fields:
            cn, pn = company_position_norm(nc, np)
            add("company", nc)
            add("position", np)
            add("company_norm", cn)
            add("position_norm", pn)

        simple_map = {
            "direction": "direction",
            "platform": "platform",
            "applied_on": "applied_on",
            "location": "location",
            "salary_range": "salary_range",
            "resume_filename": "resume_filename",
            "jd_text": "jd_text",
            "notes": "notes",
        }
        for k, col in simple_map.items():
            if k in fields:
                v = fields[k]
                add(col, "" if v is None else str(v).strip())
        if "jd_catalog_id" in fields:
            v = fields["jd_catalog_id"]
            add("jd_catalog_id", None if v in ("", None) else str(v).strip())

        if "jd_keywords" in fields:
            add("jd_keywords", "" if fields["jd_keywords"] is None else str(fields["jd_keywords"]).strip())
            add("jd_keywords_user_edited", 1)

        if "abandoned" in fields:
            add("abandoned", 1 if fields["abandoned"] else 0)

        if not assignments:
            return application_detail(conn, application_id)

        args.append(ts)
        args.append(application_id)
        conn.execute(
            f"UPDATE applications SET {', '.join(assignments)}, updated_at = ? WHERE id = ?",
            args,
        )

        conn.commit()
        return application_detail(conn, application_id)
    except DuplicateApplicationError:
        conn.rollback()
        raise
    finally:
        conn.close()


def set_stage_outcome(application_id: str, stage: str, outcome: str) -> Optional[dict[str, Any]]:
    if stage not in PIPELINE_STAGES:
        raise ValueError(f"未知环节：{stage}")
    if outcome not in (OUTCOME_PENDING, OUTCOME_PASSED, OUTCOME_FAILED):
        raise ValueError("outcome 仅可为 pending | passed | failed")

    conn = get_connection()
    try:
        cur = conn.execute("SELECT abandoned FROM applications WHERE id = ?", (application_id,))
        row = cur.fetchone()
        if not row:
            return None

        abandoned = bool(row["abandoned"])
        ts = now_iso()
        conn.execute(
            """INSERT INTO application_stages (application_id, stage, outcome, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(application_id, stage) DO UPDATE SET
               outcome = excluded.outcome,
               updated_at = excluded.updated_at""",
            (application_id, stage, outcome, ts),
        )

        idx = PIPELINE_STAGES.index(stage)
        if not abandoned and outcome == OUTCOME_PASSED and idx + 1 < len(PIPELINE_STAGES):
            nxt = PIPELINE_STAGES[idx + 1]
            conn.execute(
                """INSERT INTO application_stages (application_id, stage, outcome, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(application_id, stage) DO UPDATE SET
                   outcome = excluded.outcome,
                   updated_at = excluded.updated_at""",
                (application_id, nxt, OUTCOME_PENDING, ts),
            )

        conn.execute("UPDATE applications SET updated_at = ? WHERE id = ?", (ts, application_id))
        conn.commit()
        return application_detail(conn, application_id)
    finally:
        conn.close()


def set_jd_keywords_from_ai(application_id: str, keywords: str, *, overwrite_user: bool = False) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT jd_keywords_user_edited FROM applications WHERE id = ?", (application_id,)
        )
        row = cur.fetchone()
        if not row:
            return None
        if row["jd_keywords_user_edited"] and not overwrite_user:
            raise ValueError("JD 关键词已由用户修改，为保护编辑内容不再自动生成")
        ts = now_iso()
        conn.execute(
            """UPDATE applications SET jd_keywords = ?, jd_keywords_user_edited = 0, updated_at = ?
               WHERE id = ?""",
            (keywords.strip(), ts, application_id),
        )
        conn.commit()
        return application_detail(conn, application_id)
    finally:
        conn.close()


def list_feedbacks(application_id: str) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT * FROM feedbacks WHERE application_id = ? ORDER BY happened_at DESC, created_at DESC",
            (application_id,),
        )
        rows = [_fb_row(r) for r in cur.fetchall()]
        return rows
    finally:
        conn.close()


def _fb_row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    t = d.get("trustworthy")
    d["trustworthy"] = bool(t) if t is not None else None
    return d


def create_feedback(application_id: str, data: dict[str, Any]) -> dict[str, Any]:
    cur_id = str(uuid.uuid4())
    ts = now_iso()
    trusty = data.get("trustworthy")
    tr_val: Optional[int]
    if trusty is None:
        tr_val = None
    else:
        tr_val = 1 if bool(trusty) else 0

    conn = get_connection()
    try:
        # ensure application exists
        if not conn.execute(
            "SELECT 1 FROM applications WHERE id = ?", (application_id,)
        ).fetchone():
            raise ValueError("application 不存在")

        conn.execute(
            """
            INSERT INTO feedbacks (
              id, application_id, source, happened_at, content, feedback_type,
              trustworthy, next_action, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (
                cur_id,
                application_id,
                data["source"],
                data["happened_at"],
                data["content"],
                data["feedback_type"],
                tr_val,
                data.get("next_action") or "",
                ts,
                ts,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM feedbacks WHERE id = ?", (cur_id,)).fetchone()
        return _fb_row(row)  # type: ignore[arg-type]
    finally:
        conn.close()


def get_feedback(feedback_id: str) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM feedbacks WHERE id = ?", (feedback_id,)).fetchone()
        return _fb_row(row) if row else None  # type: ignore[arg-type]
    finally:
        conn.close()


def patch_feedback(feedback_id: str, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM feedbacks WHERE id = ?", (feedback_id,)).fetchone()
        if not row:
            return None
        ts = now_iso()
        fields = dict(row)
        updates: list[tuple[str, Any]] = []
        for k in ("source", "happened_at", "content", "feedback_type", "next_action"):
            if k in data:
                updates.append((k, data[k]))
        if "trustworthy" in data:
            t = data["trustworthy"]
            updates.append(("trustworthy", None if t is None else (1 if t else 0)))
        if not updates:
            return _fb_row(row)  # type: ignore[arg-type]
        assigns = ", ".join(f"{k} = ?" for k, _ in updates)
        vals = [v for _, v in updates] + [ts, feedback_id]
        conn.execute(f"UPDATE feedbacks SET {assigns}, updated_at = ? WHERE id = ?", vals)
        conn.commit()
        nrow = conn.execute("SELECT * FROM feedbacks WHERE id = ?", (feedback_id,)).fetchone()
        return _fb_row(nrow)  # type: ignore[arg-type]
    finally:
        conn.close()


def delete_feedback(feedback_id: str) -> bool:
    conn = get_connection()
    try:
        c = conn.execute("DELETE FROM feedbacks WHERE id = ?", (feedback_id,))
        conn.commit()
        return c.rowcount > 0
    finally:
        conn.close()


def list_interviews(application_id: Optional[str] = None) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        if application_id:
            cur = conn.execute(
                """SELECT * FROM interview_sessions WHERE application_id = ?
                   ORDER BY interview_on DESC, created_at DESC""",
                (application_id,),
            )
        else:
            cur = conn.execute(
                "SELECT * FROM interview_sessions ORDER BY interview_on DESC, created_at DESC"
            )
        return [_interview_row(r) for r in cur.fetchall()]
    finally:
        conn.close()


def _interview_row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["questions"] = json.loads(d.pop("questions_json") or "[]")
    return d


def create_interview(data: dict[str, Any]) -> dict[str, Any]:
    if data["stage"] not in PIPELINE_STAGES:
        raise ValueError("无效环节枚举")
    iid = str(uuid.uuid4())
    ts = now_iso()
    questions = data.get("questions") or []
    conn = get_connection()
    try:
        if not conn.execute(
            "SELECT 1 FROM applications WHERE id = ?", (data["application_id"],)
        ).fetchone():
            raise ValueError("application 不存在")
        conn.execute(
            """
            INSERT INTO interview_sessions (
              id, application_id, stage, interview_on, duration_min, interviewer_type,
              questions_json, result, failure_guess, improvements, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                iid,
                data["application_id"],
                data["stage"],
                data["interview_on"],
                data.get("duration_min"),
                data.get("interviewer_type") or "",
                json.dumps(questions, ensure_ascii=False),
                data.get("result") or "",
                data.get("failure_guess") or "",
                data.get("improvements") or "",
                ts,
                ts,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM interview_sessions WHERE id = ?", (iid,)).fetchone()
        return _interview_row(row)  # type: ignore[arg-type]
    finally:
        conn.close()


def get_interview(session_id: str) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM interview_sessions WHERE id = ?", (session_id,)).fetchone()
        return _interview_row(row) if row else None  # type: ignore[arg-type]
    finally:
        conn.close()


def patch_interview(session_id: str, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM interview_sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        if "stage" in data and data["stage"] not in PIPELINE_STAGES:
            raise ValueError("无效环节枚举")
        ts = now_iso()
        cols = dict(row)
        qa = cols.get("questions_json")
        qlist = json.loads(qa) if qa else []
        sets: list[str] = []
        args: list[Any] = []
        mappings = (
            ("application_id", "application_id"),
            ("stage", "stage"),
            ("interview_on", "interview_on"),
            ("duration_min", "duration_min"),
            ("interviewer_type", "interviewer_type"),
            ("result", "result"),
            ("failure_guess", "failure_guess"),
            ("improvements", "improvements"),
        )
        for inp, dbcol in mappings:
            if inp in data:
                sets.append(f"{dbcol} = ?")
                args.append(data[inp])

        if "questions" in data:
            sets.append("questions_json = ?")
            args.append(json.dumps(data["questions"], ensure_ascii=False))

        if not sets:
            return _interview_row(row)  # type: ignore[arg-type]

        sets.append("updated_at = ?")
        args.append(ts)
        args.append(session_id)
        conn.execute(
            f"UPDATE interview_sessions SET {', '.join(sets)} WHERE id = ?", args,
        )
        conn.commit()
        nrow = conn.execute("SELECT * FROM interview_sessions WHERE id = ?", (session_id,)).fetchone()
        return _interview_row(nrow)  # type: ignore[arg-type]
    finally:
        conn.close()


def delete_interview(session_id: str) -> bool:
    conn = get_connection()
    try:
        c = conn.execute("DELETE FROM interview_sessions WHERE id = ?", (session_id,))
        conn.commit()
        return c.rowcount > 0
    finally:
        conn.close()


def resolve_date_window(
    *,
    days: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> tuple[str, str]:
    """返回 [applied_from, applied_to] ISO 日期 yyyy-mm-dd（含端点），本地时区日历日."""
    tz = datetime.now(timezone.utc).astimezone().tzinfo
    today = datetime.now(tz).date()
    if from_date or to_date:
        d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        if from_date:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date()
        else:
            d_from = d_to - timedelta(days=(days or 30) - 1)
    else:
        n = days if days is not None else 30
        if n < 1:
            n = 30
        d_to = today
        d_from = today - timedelta(days=n - 1)
    return d_from.isoformat(), d_to.isoformat()


def insert_ai_coach_snapshot(
    *,
    resume_filename: str,
    jd_analysis_id: Optional[str],
    days: int,
    focus: str,
    applied_from: str,
    applied_to: str,
    markdown: str,
) -> dict[str, Any]:
    rid = str(uuid.uuid4())
    ts = now_iso()
    rn = (resume_filename or "").strip()
    jd = ((jd_analysis_id or "").strip() or None)

    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO ai_coach_snapshots
               (id, resume_filename, jd_analysis_id, days, focus, applied_from, applied_to, markdown, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rid, rn, jd, days, focus, applied_from, applied_to, markdown, ts),
        )
        conn.commit()
        return get_ai_coach_snapshot(rid) or {}
    finally:
        conn.close()


def get_ai_coach_snapshot(sid: str) -> Optional[dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM ai_coach_snapshots WHERE id = ?", (sid,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def latest_ai_coach_snapshot(*, days: int, focus: str, resume_filename: str) -> Optional[dict[str, Any]]:
    rn = (resume_filename or "").strip()
    conn = get_connection()
    try:
        cur = conn.execute(
            """SELECT * FROM ai_coach_snapshots
               WHERE days = ? AND focus = ? AND resume_filename = ?
               ORDER BY created_at DESC LIMIT 1""",
            (days, focus, rn),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
