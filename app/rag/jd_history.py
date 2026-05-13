from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings


def _history_path() -> Path:
    p = settings.chroma_dir.parent / "jd_history.json"
    return p


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


def upsert_entry(
    *,
    company: str,
    position: str,
    jd_text: str,
    analysis: dict[str, Any],
    citations_count: int,
    entry_id: str | None = None,
) -> dict[str, Any]:
    entries = _load()
    now = _now_iso()

    if entry_id:
        for e in entries:
            if e["id"] == entry_id:
                e["last_matched_at"] = now
                e["analysis"] = analysis
                e["citations_count"] = citations_count
                e["company"] = company or e["company"]
                e["position"] = position or e["position"]
                e["jd_text"] = jd_text or e["jd_text"]
                _save(entries)
                return e

    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "company": company,
        "position": position,
        "jd_text": jd_text,
        "first_matched_at": now,
        "last_matched_at": now,
        "analysis": analysis,
        "citations_count": citations_count,
    }
    entries.insert(0, entry)
    _save(entries)
    return entry


def list_entries() -> list[dict[str, Any]]:
    entries = _load()
    return [
        {
            "id": e["id"],
            "company": e.get("company", ""),
            "position": e.get("position", ""),
            "first_matched_at": e.get("first_matched_at", ""),
            "last_matched_at": e.get("last_matched_at", ""),
            "score": e.get("analysis", {}).get("score"),
            "summary": e.get("analysis", {}).get("summary", ""),
            "citations_count": e.get("citations_count", 0),
        }
        for e in entries
    ]


def get_entry(entry_id: str) -> dict[str, Any] | None:
    for e in _load():
        if e["id"] == entry_id:
            return e
    return None


def delete_entry(entry_id: str) -> bool:
    entries = _load()
    new = [e for e in entries if e["id"] != entry_id]
    if len(new) == len(entries):
        return False
    _save(new)
    return True
