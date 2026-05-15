from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings


def _catalog_path() -> Path:
    return settings.chroma_dir.parent / "jd_catalog.json"


def _normalize_entry(e: dict[str, Any]) -> dict[str, Any]:
    """保证旧版 jd_catalog.json 可读；关键词与备注为资料库级字段。"""
    e.setdefault("jd_keywords", "")
    e.setdefault("notes", "")
    ue = e.get("jd_keywords_user_edited")
    if ue is None:
        e["jd_keywords_user_edited"] = False
    elif isinstance(ue, bool):
        e["jd_keywords_user_edited"] = ue
    else:
        s = str(ue).strip().lower()
        e["jd_keywords_user_edited"] = s in ("1", "true", "yes", "on")
    e["jd_keywords"] = "" if e.get("jd_keywords") is None else str(e["jd_keywords"])
    e["notes"] = "" if e.get("notes") is None else str(e["notes"])
    return e


def _load() -> list[dict[str, Any]]:
    p = _catalog_path()
    if not p.is_file():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [_normalize_entry(dict(x)) for x in raw] if isinstance(raw, list) else []


def _save(entries: list[dict[str, Any]]) -> None:
    p = _catalog_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_entry(
    *,
    company: str,
    position: str,
    jd_text: str,
    jd_keywords: str = "",
    notes: str = "",
) -> dict[str, Any]:
    entries = _load()
    now = _now_iso()
    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "company": company,
        "position": position,
        "jd_text": jd_text,
        "jd_keywords": jd_keywords.strip() if jd_keywords else "",
        "jd_keywords_user_edited": False,
        "notes": notes.strip() if notes else "",
        "created_at": now,
        "updated_at": now,
    }
    entries.insert(0, entry)
    _save(entries)
    return dict(entry)


def update_entry(
    jd_id: str,
    *,
    company: str | None = None,
    position: str | None = None,
    jd_text: str | None = None,
    jd_keywords: str | None = None,
    notes: str | None = None,
) -> dict[str, Any] | None:
    entries = _load()
    for e in entries:
        if e["id"] == jd_id:
            if company is not None:
                e["company"] = company
            if position is not None:
                e["position"] = position
            if jd_text is not None:
                e["jd_text"] = jd_text
            if jd_keywords is not None:
                e["jd_keywords"] = str(jd_keywords).strip()
                e["jd_keywords_user_edited"] = True
            if notes is not None:
                e["notes"] = str(notes).strip()
            e["updated_at"] = _now_iso()
            _save(entries)
            return dict(_normalize_entry(e))
    return None


def set_jd_catalog_keywords_ai(jd_id: str, keywords_line: str) -> dict[str, Any] | None:
    """由 AI 写入关键词草稿，并清除『用户手动编辑』标记。"""
    entries = _load()
    for e in entries:
        if e["id"] == jd_id:
            e["jd_keywords"] = keywords_line.strip()
            e["jd_keywords_user_edited"] = False
            e["updated_at"] = _now_iso()
            _save(entries)
            return dict(_normalize_entry(e))
    return None


def delete_entry(jd_id: str) -> bool:
    entries = _load()
    new = [e for e in entries if e["id"] != jd_id]
    if len(new) == len(entries):
        return False
    _save(new)
    return True


def get_entry(jd_id: str) -> dict[str, Any] | None:
    for e in _load():
        if e["id"] == jd_id:
            return e
    return None


def list_entries() -> list[dict[str, Any]]:
    return _load()


# ── Migration from old jd_history.json format ─────────────────────────────────

def migrate_from_history(old_history: list[dict[str, Any]]) -> dict[str, str]:
    """
    Convert old combined records into catalog entries.
    Returns mapping {old_history_id: new_jd_catalog_id}.
    """
    if not old_history:
        return {}

    existing = {e["id"] for e in _load()}
    mapping: dict[str, str] = {}
    new_catalog: list[dict[str, Any]] = []

    for h in old_history:
        jd_id = str(uuid.uuid4())
        mapping[h["id"]] = jd_id
        entry: dict[str, Any] = {
            "id": jd_id,
            "company": h.get("company", ""),
            "position": h.get("position", ""),
            "jd_text": h.get("jd_text", ""),
            "jd_keywords": "",
            "notes": "",
            "jd_keywords_user_edited": False,
            "created_at": h.get("first_matched_at", _now_iso()),
            "updated_at": h.get("last_matched_at", _now_iso()),
        }
        new_catalog.append(entry)

    current = _load()
    _save(new_catalog + current)
    return mapping
