from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.config import settings
from app.rag.store import VectorStore


_store: Optional[VectorStore] = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store


def invalidate_store_cache() -> None:
    global _store
    _store = None


async def require_secret(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-Api-Key"),
) -> None:
    secret = settings.api_secret
    if not secret:
        return
    token: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if x_api_key:
        token = x_api_key.strip()
    if token != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
