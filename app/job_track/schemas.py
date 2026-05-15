from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.job_track.constants import POSITION_DIRECTIONS, STAGE_OUTCOMES


class ApplicationCreate(BaseModel):
    company: str = Field(..., min_length=1, max_length=200)
    position: str = Field(..., min_length=1, max_length=200)
    direction: str = Field(..., min_length=1, max_length=80)
    applied_on: str = Field(..., min_length=10, max_length=10, description="YYYY-MM-DD")
    platform: str = Field(default="", max_length=120)
    location: str = Field(default="", max_length=200)
    salary_range: str = Field(default="", max_length=160)
    resume_filename: str = Field(default="", max_length=300)
    jd_catalog_id: Optional[str] = Field(default=None, max_length=80)
    jd_text: str = Field(default="", max_length=52000)
    jd_keywords: str = Field(default="", max_length=8000)
    notes: str = Field(default="", max_length=16000)


class ApplicationPatch(BaseModel):
    company: Optional[str] = Field(default=None, max_length=200)
    position: Optional[str] = Field(default=None, max_length=200)
    direction: Optional[str] = Field(default=None, max_length=80)
    applied_on: Optional[str] = Field(default=None, max_length=10)
    platform: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=200)
    salary_range: Optional[str] = Field(default=None, max_length=160)
    resume_filename: Optional[str] = Field(default=None, max_length=300)
    jd_catalog_id: Optional[str] = Field(default=None, max_length=80)
    jd_text: Optional[str] = Field(default=None, max_length=52000)
    jd_keywords: Optional[str] = Field(default=None, max_length=8000)
    notes: Optional[str] = Field(default=None, max_length=16000)
    abandoned: Optional[bool] = None


class StageOutcomePatch(BaseModel):
    outcome: str = Field(..., description="|".join(STAGE_OUTCOMES))


class FeedbackCreate(BaseModel):
    """创建反馈：前后端可能对可选字段传 null / 字符串布尔，在此归一。"""

    model_config = ConfigDict(str_strip_whitespace=True)

    source: str = Field(..., min_length=1, max_length=60)
    happened_at: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=20000)
    feedback_type: str = Field(..., min_length=1, max_length=80)
    trustworthy: Optional[bool] = None
    next_action: Optional[str] = Field(default=None, max_length=8000)

    @field_validator("trustworthy", mode="before")
    @classmethod
    def coerce_trustworthy(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            sl = v.strip().lower()
            if sl in ("true", "1", "yes", "on"):
                return True
            if sl in ("false", "0", "no", "off"):
                return False
            return None
        if isinstance(v, (int, float)):
            return bool(int(v))
        return v

    @field_validator("next_action", mode="before")
    @classmethod
    def empty_next_as_none(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v


class FeedbackPatch(BaseModel):
    source: Optional[str] = Field(default=None, max_length=60)
    happened_at: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = Field(default=None, max_length=20000)
    feedback_type: Optional[str] = Field(default=None, max_length=80)
    trustworthy: Optional[bool] = None
    next_action: Optional[str] = Field(default=None, max_length=8000)


class QuestionItem(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    category: Optional[str] = Field(default=None, max_length=60)
    weak: bool = False


class InterviewCreate(BaseModel):
    application_id: str = Field(..., min_length=8, max_length=48)
    stage: str = Field(..., min_length=2, max_length=40)
    interview_on: str = Field(..., min_length=10, max_length=40)
    duration_min: Optional[int] = Field(default=None, ge=5, le=720)
    interviewer_type: str = Field(default="", max_length=120)
    questions: list[QuestionItem] = Field(default_factory=list)
    result: str = Field(default="", max_length=4000)
    failure_guess: str = Field(default="", max_length=8000)
    improvements: str = Field(default="", max_length=8000)


class InterviewPatch(BaseModel):
    application_id: Optional[str] = Field(default=None, max_length=48)
    stage: Optional[str] = Field(default=None, max_length=40)
    interview_on: Optional[str] = Field(default=None, max_length=40)
    duration_min: Optional[int] = Field(default=None, ge=5, le=720)
    interviewer_type: Optional[str] = Field(default=None, max_length=120)
    questions: Optional[list[QuestionItem]] = None
    result: Optional[str] = Field(default=None, max_length=4000)
    failure_guess: Optional[str] = Field(default=None, max_length=8000)
    improvements: Optional[str] = Field(default=None, max_length=8000)


AI_COACH_DEFAULT_FOCUS = "综合复盘与下周策略"


class AiCoachBody(BaseModel):
    days: int = Field(default=30, ge=1, le=366)
    focus: str = Field(default=AI_COACH_DEFAULT_FOCUS, max_length=200)
    resume_filename: str = Field(default="", max_length=300)
    jd_analysis_id: Optional[str] = Field(default=None, max_length=80)


def direction_ok(d: str) -> bool:
    return d in POSITION_DIRECTIONS


def patch_to_dict(body: ApplicationPatch) -> dict[str, Any]:
    raw = body.model_dump(exclude_unset=True)
    if "jd_catalog_id" in raw and raw["jd_catalog_id"] == "":
        raw["jd_catalog_id"] = None


    return raw
