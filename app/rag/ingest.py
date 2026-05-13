from __future__ import annotations

import hashlib
from pathlib import Path

from app.config import settings
from app.llm import embed_texts
from app.rag.chunk_md import iter_knowledge_md_files, split_markdown_file
from app.rag.store import VectorStore


def _chunk_id(rel: str, pos: int) -> str:
    h = hashlib.md5(rel.encode("utf-8")).hexdigest()[:10]
    return f"{h}_{pos}"


async def run_ingest(reset: bool = False) -> tuple[int, list[str]]:
    root = settings.knowledge_root.resolve()
    files = iter_knowledge_md_files(root)
    if not files:
        return 0, []

    store = VectorStore()
    if reset:
        store.reset()

    all_chunks: list = []
    logs: list[str] = []
    for path in files:
        try:
            rel_root = root
            chs = split_markdown_file(path, rel_root, settings.chunk_size, settings.chunk_overlap)
            all_chunks.extend(chs)
            logs.append(f"[ingest] {path.relative_to(root)} -> {len(chs)} chunks")
        except Exception as e:
            logs.append(f"[ingest] SKIP {path}: {e}")

    if not all_chunks:
        return 0, logs

    batch = 25  # DashScope text-embedding-v2 limit
    global_pos = 0
    for i in range(0, len(all_chunks), batch):
        slice_ = all_chunks[i : i + batch]
        texts = [c.text for c in slice_]
        embeddings = await embed_texts(texts)
        ids: list[str] = []
        docs: list[str] = []
        metas: list[dict] = []
        for j, c in enumerate(slice_):
            cid = _chunk_id(c.source_path, global_pos + j)
            ids.append(cid)
            docs.append(c.text)
            metas.append(
                {
                    "source_path": c.source_path,
                    "heading_path": c.heading_path,
                    "doc_type": c.doc_type,
                    "position": global_pos + j,
                }
            )
        store.upsert(ids=ids, documents=docs, embeddings=embeddings, metadatas=metas)
        global_pos += len(slice_)
        logs.append(f"[ingest] upsert batch {i // batch + 1}, size {len(slice_)}")

    return len(all_chunks), logs


if __name__ == "__main__":
    import asyncio
    import sys

    async def _main():
        rst = "--reset" in sys.argv
        n, logs = await run_ingest(reset=rst)
        for line in logs:
            print(line)
        print("TOTAL_CHUNKS", n)

    asyncio.run(_main())
