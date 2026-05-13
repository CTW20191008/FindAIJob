from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    knowledge_root: Path = Field(
        default_factory=_repo_root,
        validation_alias=AliasChoices("FINDAIJOB_KNOWLEDGE_ROOT"),
    )

    chroma_dir: Path = Field(default_factory=lambda: _repo_root() / "data" / "chroma")
    collection_name: str = "resume_kb"

    openai_api_key: str = ""
    openai_base_url: Optional[str] = None
    openai_chat_model: str = "qwen-max"
    openai_embedding_model: str = "text-embedding-v2"

    api_secret: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("FINDAIJOB_API_SECRET"),
    )

    # Set to False to skip SSL verification (useful behind corporate proxies)
    openai_ssl_verify: bool = True
    # Set to True to bypass system proxy for OpenAI/LLM API calls
    openai_no_proxy: bool = False

    chunk_size: int = 1200
    chunk_overlap: int = 150
    retrieve_top_k: int = 12
    rrf_k: int = 60

    @field_validator("knowledge_root", mode="before")
    @classmethod
    def coerce_root(cls, v: Union[Path, str]) -> Path:
        return Path(v).resolve() if v else _repo_root()

    @field_validator("openai_base_url", mode="before")
    @classmethod
    def empty_base_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None or str(v).strip() == "":
            return None
        return str(v).strip()


settings = Settings()
