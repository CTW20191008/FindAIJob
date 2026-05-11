from __future__ import annotations

import json
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from app.config import settings


def get_client() -> AsyncOpenAI:
    kwargs: dict[str, Any] = {"api_key": settings.openai_api_key or "dummy"}
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url.rstrip("/")
    return AsyncOpenAI(**kwargs)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    client = get_client()
    resp = await client.embeddings.create(
        model=settings.openai_embedding_model,
        input=texts,
    )
    return [d.embedding for d in resp.data]


async def chat_complete(
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> str:
    client = get_client()
    resp = await client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


async def chat_complete_stream(
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> AsyncIterator[str]:
    client = get_client()
    stream = await client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for evt in stream:
        if evt.choices and evt.choices[0].delta.content:
            yield evt.choices[0].delta.content


def safe_json_extract(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {"raw": text}
