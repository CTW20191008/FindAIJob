from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings

# Schema (new): each record is one analysis run for a specific JD + resume.
# {
#   "id":               str (uuid),
#   "jd_id":            str (references jd_catalog),
#   "resume_filename":  str,
#   "matched_at":       ISO str,
#   "analysis":         dict,
#   "citations_count":  int,
#   "has_question_bank": bool,
#   "qb_categories":    list[str],
# }

# 资料库题库挂点（不按单次简历对标）；与 JD 匹配页产生的分析区分开
QB_ANCHOR_SENTINEL = "__jd_catalog_qb__"


def _history_path() -> Path:
    return settings.chroma_dir.parent / "jd_history.json"


def _load() -> list[dict[str, Any]]:
    p = _history_path()
    if not p.is_file():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(entries: list[dict[str, Any]]) -> None:
    p = _history_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ── CRUD ──────────────────────────────────────────────────────────────────────

def upsert_analysis(
    *,
    jd_id: str,
    resume_filename: str,
    analysis: dict[str, Any],
    citations_count: int,
    analysis_id: str | None = None,
) -> dict[str, Any]:
    entries = _load()
    now = _now_iso()

    if analysis_id:
        for e in entries:
            if e["id"] == analysis_id:
                # Different resume → create new entry
                stored = e.get("resume_filename", "")
                if resume_filename and stored and resume_filename != stored:
                    break
                e["matched_at"] = now
                e["analysis"] = analysis
                e["citations_count"] = citations_count
                e["resume_filename"] = resume_filename
                _save(entries)
                return e

    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "jd_id": jd_id,
        "resume_filename": resume_filename,
        "matched_at": now,
        "analysis": analysis,
        "citations_count": citations_count,
        "has_question_bank": False,
        "qb_categories": [],
    }
    entries.insert(0, entry)
    _save(entries)
    return entry


def list_for_jd(jd_id: str, *, hide_qb_anchor: bool = True) -> list[dict[str, Any]]:
    xs = [e for e in _load() if e.get("jd_id") == jd_id]
    if hide_qb_anchor:
        xs = [e for e in xs if e.get("resume_filename") != QB_ANCHOR_SENTINEL]
    return xs


def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    for e in _load():
        if e["id"] == analysis_id:
            return e
    return None


def delete_analysis(analysis_id: str) -> bool:
    entries = _load()
    new = [e for e in entries if e["id"] != analysis_id]
    if len(new) == len(entries):
        return False
    _save(new)
    return True


def ensure_question_bank_anchor(jd_id: str) -> dict[str, Any]:
    """每个 JD 在资料库里最多一条题库挂点记录，便于与 RAG 中 question_bank 的 entry_id 对应。"""
    for e in _load():
        if e.get("jd_id") == jd_id and e.get("resume_filename") == QB_ANCHOR_SENTINEL:
            return e
    return upsert_analysis(
        jd_id=jd_id,
        resume_filename=QB_ANCHOR_SENTINEL,
        analysis={
            "summary": "本条由「JD 资料库」生成的面试题库挂载点（不绑定单次简历对标分析）。",
            "score": None,
            "match_points": [],
            "gaps": [],
            "suggestions": [],
            "risks": [],
        },
        citations_count=0,
    )


def delete_for_jd(jd_id: str) -> int:
    entries = _load()
    new = [e for e in entries if e.get("jd_id") != jd_id]
    removed = len(entries) - len(new)
    if removed:
        _save(new)
    return removed


def set_question_bank(analysis_id: str, has: bool, categories: list[str] | None = None) -> None:
    entries = _load()
    for e in entries:
        if e["id"] == analysis_id:
            e["has_question_bank"] = has
            if categories is not None:
                e["qb_categories"] = categories
            _save(entries)
            return


# ── Migration from old combined format ────────────────────────────────────────

def is_old_format(entries: list[dict[str, Any]]) -> bool:
    """Old format has jd_text directly in the record."""
    return bool(entries) and "jd_text" in entries[0]


def migrate_to_new_format(old_entries: list[dict[str, Any]], id_map: dict[str, str]) -> None:
    """Rewrite history using new schema referencing jd_catalog ids."""
    new_entries = []
    for h in old_entries:
        jd_id = id_map.get(h["id"], "")
        if not jd_id:
            continue
        new_entries.append({
            "id": h["id"],
            "jd_id": jd_id,
            "resume_filename": h.get("resume_filename", ""),
            "matched_at": h.get("last_matched_at", _now_iso()),
            "analysis": h.get("analysis", {}),
            "citations_count": h.get("citations_count", 0),
            "has_question_bank": h.get("has_question_bank", False),
            "qb_categories": h.get("qb_categories", []),
        })
    _save(new_entries)
