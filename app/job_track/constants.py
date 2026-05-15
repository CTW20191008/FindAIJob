from __future__ import annotations

# 环节顺序（到 Offer）
PIPELINE_STAGES: tuple[str, ...] = (
    "简历投递",
    "HR沟通",
    "一面",
    "二面",
    "终面",
    "Offer环节",
)

# 统一存储三态（展示层可按环节换文案）
OUTCOME_PENDING = "pending"
OUTCOME_PASSED = "passed"
OUTCOME_FAILED = "failed"

STAGE_OUTCOMES: tuple[str, ...] = (OUTCOME_PENDING, OUTCOME_PASSED, OUTCOME_FAILED)

# 岗位方向
POSITION_DIRECTIONS: tuple[str, ...] = (
    "RAG/大模型应用",
    "AI Agent",
    "多模态/CV+LLM",
    "计算机视觉",
    "推荐/AI社区",
    "算法工程化",
    "AI解决方案",
    "其他",
)

# 投递平台（建议项，仍可自由输入）
SUGGESTED_PLATFORMS: tuple[str, ...] = (
    "BOSS直聘",
    "猎聘",
    "脉脉",
    "牛客网",
    "实习僧",
    "官网/邮箱",
    "LinkedIn",
    "智联招聘",
)

# 反馈
FEEDBACK_SOURCES: tuple[str, ...] = (
    "HR",
    "猎头",
    "技术面试官",
    "朋友/内推人",
    "招聘平台数据",
    "自我复盘",
)

FEEDBACK_TYPES: tuple[str, ...] = (
    "方向不匹配",
    "大模型经验不足",
    "RAG项目不够深入",
    "CV背景偏重",
    "工程化表达不足",
    "算法题不足",
    "项目讲解不清",
    "薪资不匹配",
    "地点不匹配",
    "年限不匹配",
    "有更匹配候选人",
)

# 复盘问题类别
QUESTION_CATEGORIES: tuple[str, ...] = (
    "自我介绍",
    "转型动机",
    "RAG",
    "Agent",
    "多模态",
    "推荐系统",
    "计算机视觉",
    "工程化",
    "项目经历",
    "系统设计",
    "算法题",
    "管理协作",
    "HR问题",
)
