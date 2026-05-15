from __future__ import annotations

import re


_WS = re.compile(r"\s+")


def normalize_key_part(s: str) -> str:
    """公司与岗位唯一键规范化：trim、折叠空白、ASCII 为小写保留中文."""
    s = (s or "").strip()
    s = _WS.sub(" ", s)
    # 只对 ASCII 做 lower，便于英文公司名不区分大小写
    return "".join(ch.lower() if ord(ch) < 128 else ch for ch in s)


def company_position_norm(company: str, position: str) -> tuple[str, str]:
    return normalize_key_part(company), normalize_key_part(position)
