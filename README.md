# FindAIJob — AI 简历问答助手

基于仓库内 Markdown 笔记与履历事实的 **简历知识库 + RAG**，提供 **JD 匹配分析**、**面试题生成** 与 **Web 控制台**。LLM / Embedding 走 **OpenAI 兼容 HTTPS**（可接阿里云 DashScope 兼容地址、官方 OpenAI 等）。

---

## 交付对照（与你的清单）

| # | 能力 | 实现说明 |
|---|------|----------|
| 1 | **简历知识库** | `docs/**/*.md`、`profile/*.md`（含 `demo_facts.md`）；正式求职用 `profile/RESUME_FACTS.md`，见 `profile/RESUME_FACTS.md.example` |
| 2 | **RAG 问答** | `/api/ask`，Dense + BM25 混合召回（RRF），带引用 citation |
| 3 | **岗位 JD 匹配分析** | `/api/jd-match`，优先召回 `doc_type=resume` chunk，再走结构化 JSON 分析 |
| 4 | **面试问题生成** | `/api/interview-questions` |
| 5 | **Web 页面** | `static/` 单页：`/` |
| 6 | **项目 README** | 本文件 |
| 7 | **在线 Demo 或录屏** | 见 [`DEMO.md`](DEMO.md)（部署 URL 占位与录屏建议） |

---

## 环境与密钥

1. Python **3.9+**（推荐 3.11+）。
2. 复制 `.env.example` → `.env`，填写 **`OPENAI_API_KEY`**。
3. 使用 DashScope OpenAI 兼容模式时示例（与你的其它项目可对齐）：  
   - `OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`  
   - `OPENAI_CHAT_MODEL`、`OPENAI_EMBEDDING_MODEL` 按控制台文档改名（如 `qwen-max`、`text-embedding-v2`）。

**公网必选**：`.env` 中设置 **`FINDAIJOB_API_SECRET`**；浏览器在页面「API 密钥」框填入相同值（请求头会自动带 Bearer + X-Api-Key）。

本地调试可不设密钥，便于快速跑通 ingest。

---

## 安装与运行

```bash
cd FindAIJob
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 建立向量索引（首次 / 改过 md）
python -m app.rag.ingest --reset

# 启动
python run.py
# http://localhost:8848/
```

索引范围：仓库根、`docs/`、`profile/` 下 Markdown（文件名含 `.example` 的跳过）。

**换 Embedding 模型**后请删除数据目录 **`data/chroma`** 再 `ingest`。

---

## API 概要

所有写操作与问答接口若配置了 `FINDAIJOB_API_SECRET` 均需鉴权。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/` | Web UI |
| GET | `/docs` | OpenAPI |
| POST | `/api/ask` | `{ "question","doc_type"?,"show_chunks"? }` |
| POST | `/api/jd-match` | `{ "jd_text" }` |
| POST | `/api/interview-questions` | `{ "focus","count" }` |
| POST | `/api/admin/ingest` | `{ "reset": bool }` |

---

## Docker

```bash
cp .env.example .env && vim .env
docker compose build
docker compose up -d

# 进容器跑一次索引（或通过 curl 调 /api/admin/ingest）
docker compose exec findaijob python -m app.rag.ingest --reset
```

---

## 设计文档与扩展

- 产品：`docs/plans/2026-05-11-ai-resume-qa-assistant-design.md`
- RAG：`docs/RAG系统设计_定稿.md`
- 面试笔记：`docs/大模型与多模态面试笔记_定稿.md`

---

## 免责声明

本产品仅辅助整理与复述 **你提供的材料**，不替你编造经历。云服务调用受各厂商数据处理条款约束。
