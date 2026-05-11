from __future__ import annotations

import re
from typing import Any

import chromadb
from chromadb.api.models.Collection import Collection

from app.config import settings


def zh_tokenize(text: str) -> list[str]:
    raw = re.findall(r"[\u4e00-\u9fff]{1,2}|[\u4e00-\u9fff]+|[a-zA-Z]{2,}|\d+", text.lower())
    return raw if raw else ["__empty__"]


class VectorStore:
    def __init__(self) -> None:
        settings.chroma_dir.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=str(settings.chroma_dir))
        self._collection = self._client.get_or_create_collection(
            name=settings.collection_name,
            metadata={"embedding_model": settings.openai_embedding_model},
        )

    @property
    def collection(self) -> Collection:
        return self._collection

    def reset(self) -> None:
        try:
            self._client.delete_collection(settings.collection_name)
        except Exception:
            pass
        self._collection = self._client.get_or_create_collection(
            name=settings.collection_name,
            metadata={"embedding_model": settings.openai_embedding_model},
        )

    def upsert(
        self,
        ids: list[str],
        documents: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None:
        self._collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )

    def query(self, embedding: list[float], n: int) -> dict[str, Any]:
        return self._collection.query(
            query_embeddings=[embedding],
            n_results=n,
            include=["documents", "metadatas", "distances"],
        )


def load_corpus_aligned(store: VectorStore) -> tuple[list[str], list[str], list[dict[str, Any]], list[list[str]]]:
    data = store.collection.get(include=["documents", "metadatas"])
    ids = list(data.get("ids") or [])
    docs = list(data.get("documents") or [])
    metas = list(data.get("metadatas") or [])
    tokenized = [zh_tokenize(d) for d in docs]
    return ids, docs, metas, tokenized
