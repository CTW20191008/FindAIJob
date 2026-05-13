from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings


def _catalog_path() -> Path:
    return settings.chroma_dir.parent / "jd_catalog.json"


def _load() -> list[dict[str, Any]]:
    p = _catalog_path()
    if not p.is_file():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(entries: list[dict[str, Any]]) -> None:
    p = _catalog_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_entry(*, company: str, position: str, jd_text: str) -> dict[str, Any]:
    entries = _load()
    now = _now_iso()
    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "company": company,
        "position": position,
        "jd_text": jd_text,
        "created_at": now,
        "updated_at": now,
    }
    entries.insert(0, entry)
    _save(entries)
    return entry


def update_entry(
    jd_id: str,
    *,
    company: str | None = None,
    position: str | None = None,
    jd_text: str | None = None,
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
            e["updated_at"] = _now_iso()
            _save(entries)
            return e
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
            "created_at": h.get("first_matched_at", _now_iso()),
            "updated_at": h.get("last_matched_at", _now_iso()),
        }
        new_catalog.append(entry)

    current = _load()
    _save(new_catalog + current)
    return mapping
