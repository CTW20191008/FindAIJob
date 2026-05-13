from __future__ import annotations

from dataclasses import dataclass

from typing import Optional

from rank_bm25 import BM25Okapi

from app.config import settings
from app.rag.store import VectorStore, load_corpus_aligned, zh_tokenize


@dataclass
class Hit:
    cid: str
    text: str
    source_path: str
    heading_path: str
    doc_type: str
    score: float
    rank_src: str


def _rrf_id_lists(rank_id_lists: list[list[str]], k: int) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ids_ranked in rank_id_lists:
        for r, cid in enumerate(ids_ranked):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + r + 1)
    return scores


async def hybrid_retrieve(
    store: VectorStore,
    query: str,
    query_embedding: list[float],
    top_k: Optional[int] = None,
    doc_type_filter: Optional[str] = None,
    jd_entry_id_filter: Optional[str] = None,
) -> list[Hit]:
    top_k = top_k or settings.retrieve_top_k

    ids, docs, metas, tokenized = load_corpus_aligned(store)
    if not ids:
        return []

    meta_by_id = {cid: (dict(m) if m else {}) for cid, m in zip(ids, metas)}
    doc_by_id = dict(zip(ids, docs))

    n_q = min(len(ids), max(top_k * 4, 32))
    vq = store.query(query_embedding, n=n_q)
    v_ids = []
    if vq.get("ids") and vq["ids"][0]:
        v_ids = list(vq["ids"][0])

    q_tok = zh_tokenize(query)
    bm25 = BM25Okapi(tokenized)
    bm_scores = bm25.get_scores(q_tok)
    bm_order_idx = sorted(range(len(ids)), key=lambda i: bm_scores[i], reverse=True)
    bm_ids = [ids[i] for i in bm_order_idx[:n_q]]

    fused = _rrf_id_lists([v_ids, bm_ids], settings.rrf_k)

    ranked_ids = sorted(fused.keys(), key=lambda cid: fused[cid], reverse=True)

    hits: list[Hit] = []
    for cid in ranked_ids:
        m = meta_by_id.get(cid, {})
        dt = str(m.get("doc_type", "study"))
        if doc_type_filter and dt != doc_type_filter:
            continue
        if jd_entry_id_filter and m.get("jd_entry_id", "") != jd_entry_id_filter:
            continue
        txt = doc_by_id.get(cid, "")
        hits.append(
            Hit(
                cid=cid,
                text=txt,
                source_path=str(m.get("source_path", "")),
                heading_path=str(m.get("heading_path", "")),
                doc_type=dt,
                score=float(fused[cid]),
                rank_src="hybrid",
            )
        )
        if len(hits) >= top_k:
            break

    if len(hits) < top_k:
        seen_c = {h.cid for h in hits}
        for cid in v_ids:
            if len(hits) >= top_k:
                break
            if cid in seen_c:
                continue
            m = meta_by_id.get(cid, {})
            dt = str(m.get("doc_type", "study"))
            if doc_type_filter and dt != doc_type_filter:
                continue
            if jd_entry_id_filter and m.get("jd_entry_id", "") != jd_entry_id_filter:
                continue
            seen_c.add(cid)
            hits.append(
                Hit(
                    cid=cid,
                    text=doc_by_id.get(cid, ""),
                    source_path=str(m.get("source_path", "")),
                    heading_path=str(m.get("heading_path", "")),
                    doc_type=dt,
                    score=0.0,
                    rank_src="vector_fallback",
                )
            )

    return hits[:top_k]
