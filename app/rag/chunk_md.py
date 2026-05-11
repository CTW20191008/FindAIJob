from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chunk:
    text: str
    source_path: str
    heading_path: str
    doc_type: str  # study | resume
    position: int


_HEADER = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def _doc_type_for_path(rel: str) -> str:
    r = rel.replace("\\", "/").upper()
    if "RESUME_FACTS" in r or "DEMO_FACTS" in r:
        return "resume"
    return "study"


def split_markdown_file(path: Path, root: Path, chunk_size: int, overlap: int) -> list[Chunk]:
    try:
        rel = str(path.relative_to(root.resolve()))
    except ValueError:
        rel = str(path)
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    doc_type = _doc_type_for_path(rel)

    sections: list[tuple[str, str]] = []
    current_title = ""
    current_lines: list[str] = []

    def flush():
        nonlocal current_lines
        if current_lines:
            body = "\n".join(current_lines).strip()
            if body:
                sections.append((current_title, body))
        current_lines = []

    for line in lines:
        m = _HEADER.match(line)
        if m:
            flush()
            current_title = m.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)
    flush()

    if not sections:
        sections = [("", raw.strip())]

    chunks: list[Chunk] = []
    pos = 0
    for heading, body in sections:
        hp = heading or "(root)"
        start = 0
        while start < len(body):
            end = min(start + chunk_size, len(body))
            piece = body[start:end].strip()
            if piece:
                chunks.append(
                    Chunk(
                        text=piece,
                        source_path=rel,
                        heading_path=hp,
                        doc_type=doc_type,
                        position=pos,
                    )
                )
                pos += 1
            if end >= len(body):
                break
            start = max(0, end - overlap)

    return chunks


def iter_knowledge_md_files(root: Path) -> list[Path]:
    root = root.resolve()
    paths: list[Path] = []
    docs = root / "docs"
    if docs.is_dir():
        paths.extend(sorted(docs.rglob("*.md")))
    prof = root / "profile"
    if prof.is_dir():
        paths.extend(sorted(prof.glob("*.md")))
    paths.extend(sorted(root.glob("*.md")))

    seen: set[Path] = set()
    out: list[Path] = []
    for p in paths:
        if not p.is_file() or ".example" in p.name.lower():
            continue
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            out.append(rp)
    return sorted(out, key=lambda x: str(x))
