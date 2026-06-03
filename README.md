# FindAIJob — AI 简历问答助手

基于仓库内 Markdown 笔记与履历事实的 **简历知识库 + RAG**，提供 **JD 匹配分析**、**面试题 / 题库**、**学习笔记**、**多份简历管理** 与 **Web 控制台**。LLM / Embedding 走 **OpenAI 兼容 HTTPS**（可接阿里云 DashScope、官方 OpenAI 等）。

---

## 交付对照（与你的清单）

| # | 能力 | 实现说明 |
|---|------|----------|
| 1 | **简历知识库** | `docs/**/*.md`、`profile/*.md`；正式求职用 `profile/RESUME_FACTS.md`（勿提交），见 `profile/RESUME_FACTS.md.example`；演示用 `profile/demo_facts.md` |
| 2 | **多份简历** | Web 上传 PDF/DOCX → `profile/resume_facts_{时间戳}_{标题}.md`（勿提交），自动 ingest |
| 3 | **RAG 问答** | `/api/ask`，Dense + BM25 混合召回（RRF），可按 `doc_type`、题库来源过滤，`show_chunks` 可选 |
| 4 | **JD 资料库 + 匹配分析** | JD 存于 **`data/jd_catalog.json`**，每次分析存 **`data/jd_history.json`**；匹配走 `/api/jd-match`（入参含 `jd_id`） |
| 5 | **面试题生成** | `/api/interview-questions`；可选用某次分析生成的题库缩小检索范围 |
| 6 | **JD 题库 → RAG** | `/api/jd-history/{analysis_id}/question-bank` 生成 Markdown 至 `docs/question_banks/`（默认勿提交） |
| 7 | **学习笔记** | Web 录入或上传 → `docs/notes/`（默认勿提交），`doc_type=study` |
| 8 | **Web 页面** | `static/`：`/` |
| 9 | **项目 README** | 本文件 |
| 10 | **在线 Demo 或录屏** | 见 [`DEMO.md`](DEMO.md) |
| 11 | **求职追踪 · AI 建议** | 对标分析级持久化：快照表 `ai_coach_snapshots`（`data/job_track.db`），键为 `days` + `focus` + `resume_filename`；`GET /api/job-track/ai/coach/latest`、`POST /api/job-track/ai/coach` |

---

## 环境与密钥

1. Python **3.9+**（推荐 3.11+）。
2. 复制 `.env.example` → `.env`，填写 **`OPENAI_API_KEY`**。
3. 使用 DashScope 兼容模式时可设置：  
   - `OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`  
   - `OPENAI_CHAT_MODEL`、`OPENAI_EMBEDDING_MODEL`（如 `qwen-max`、`text-embedding-v2`）。

**公网必选**：`.env` 中设置 **`FINDAIJOB_API_SECRET`**；浏览器在页面「API 密钥」折叠区填入相同值（请求头 Bearer + X-Api-Key）。本地可不设密钥。

**代理 / SSL**：若在企业的 HTTPS 代理下出现 handshake 失败，可在 `.env` 中按需开启 `OPENAI_NO_PROXY=true` 或 **`OPENAI_SSL_VERIFY=false`**（仅建议本地调试），见 `.env.example` 注释。

---

## 「索引」页面是做什么的？

Ingest 会把知识根目录下符合条件 **Markdown** 切块、向量化并写入 **`data/chroma/`**。一般在以下情况后需要执行一次：**首次部署**、**修改/新增了大量 md**、**换了 Embedding 模型**、**服务端上传简历/笔记/生成题库后的自动 ingest 失败**时再手动补偿。换嵌入模型时请 **删掉 `data/chroma` 后全量 ingest**。

---

## 技术架构与 RAG 流程

FindAIJob 采用轻量级 Web 架构：后端为 **Python / FastAPI**，前端为静态页面 `static/`，知识索引写入本地 **Chroma**，业务状态由 JSON 文件与 **SQLite** 承载。LLM 与 Embedding 走 **OpenAI 兼容接口**，因此可以在不同兼容模型服务之间切换。

核心数据分为四类：

- **非结构化文档**：简历事实、学习笔记、题库等统一转为 Markdown / 纯文本后进入 RAG 索引。
- **半结构化记录**：JD 资料库与匹配历史分别保存在 `data/jd_catalog.json`、`data/jd_history.json`。
- **流程型数据**：求职追踪中的投递、环节、反馈、复盘和 AI 建议快照保存到 `data/job_track.db`。
- **多版本材料**：多份简历、不同 JD 分析、不同统计窗口的 AI 建议都保留独立记录，便于回溯。

在线 RAG 链路如下：

1. **数据接入**：上传或录入简历、笔记、JD、题库等材料，并保留来源、类型、文件名、题库关联 ID 等元数据。
2. **索引构建**：`ingest` 对 Markdown 做切块、元数据标注、Embedding，并写入 `data/chroma/`。
3. **查询过滤**：`POST /api/ask` 可按 `doc_type`、题库来源等条件限制检索范围。
4. **混合召回**：同时使用 **Dense 向量检索** 与 **BM25 关键词检索**。
5. **RRF 融合**：通过 Reciprocal Rank Fusion 合并两路召回结果，兼顾语义相关性与关键词命中。
6. **上下文组装与生成**：按相关性、来源和长度预算拼接上下文，交给 LLM 生成回答；`show_chunks` 可展示命中片段，便于核查与调试。

这套链路让项目不只做“单次问答”，还可以支撑 **JD 对标、面试题生成、题库沉淀、求职追踪复盘与 AI 建议持久化** 等业务动作。

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

索引范围：`knowledge_root`（默认仓库根）下，`docs/`、`profile/` 等路径中的 Markdown（含 `*` 文件名中含 `.example` 的跳过，见 ingest 脚本逻辑）。

---

## API 概要

配置了 `FINDAIJOB_API_SECRET` 时，除 `/`、`/health`、静态资源外，多数接口需在请求头携带密钥。

**求职追踪 · AI 建议**：与 **JD 匹配分析写 `jd_history.json`** 类似，教练输出落在 **SQLite**，按 **`days` + `focus` + `resume_filename`（可为空）** 区分「最近一次」；可选 **`jd_analysis_id`** 把某次对标分析绑进单次生成上下文。Web「求职追踪」页先拉 `GET .../ai/coach/latest`，「重新生成」走 `POST .../ai/coach`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/` | Web UI |
| GET | `/docs` | OpenAPI |
| POST | `/api/ask` | 问答：`question`，可选 `doc_type`，可选 `jd_entry_id`（**对应某次分析 ID**，用于限定 `question_bank` 检索），`show_chunks` |
| GET | `/api/jd-catalog` | JD 列表（含每项分析次数） |
| POST | `/api/jd-catalog` | 新增 JD：`company`, `position`, `jd_text` |
| GET/PUT/DELETE | `/api/jd-catalog/{jd_id}` | 查看 / 更新 / **删除 JD（会级联删该 JD 下所有分析记录）** |
| GET | `/api/jd-catalog/{jd_id}/analyses` | 某 JD 下的匹配分析列表 |
| POST | `/api/jd-match` | 匹配：`jd_id`，可选 `resume_filename`、`analysis_id`（再次分析时传入则更新对应记录逻辑由服务端处理） |
| GET/DELETE | `/api/jd-history/{analysis_id}` | **仅删一条分析**，JD 本体仍在资料库 |
| POST | `/api/jd-history/{analysis_id}/question-bank` | 生成题库 md 并重 ingest |
| POST | `/api/interview-questions` | `focus`, `count`，可选 `jd_entry_id`（与问答中同名，实为 **题库关联的分析记录 ID**） |
| POST | `/api/answer-compare` | 面试作答与参考要点对比打分 |
| GET/PUT/DELETE | `/api/resumes`、`/api/resumes/{filename}` | 简历列表与读写删除 |
| POST | `/api/upload-resume` | 上传 PDF/DOCX → 抽取文本落盘并 ingest |
| GET/POST | `/api/notes`、`POST /api/notes/upload` 等 | 学习笔记 CRUD |
| GET | `/api/job-track/meta` | 枚举：环节、方向、反馈来源/类型等 |
| GET | `/api/job-track/applications` | 投递列表；`days` 或 `from_date`/`to_date`；可选 `direction`、`resume_filename` |
| POST | `/api/job-track/applications` | 新建投递（**公司+岗位**全库唯一）；自动创建「简历投递=待定」环节 |
| GET/PATCH/DELETE | `/api/job-track/applications/{id}` | 详情 / 更新 / 删除（级联子表） |
| PATCH | `/api/job-track/applications/{id}/stages/{stage}` | 环节三态 `pending`/`passed`/`failed`；上游 `passed` 且未放弃时自动解锁下一环节为 `pending` |
| POST | `/api/job-track/applications/{id}/jd-keywords-draft` | LLM 提取 JD 关键词（用户已手改关键词则拒绝） |
| GET/POST | `/api/job-track/applications/{id}/feedbacks` | 反馈列表与创建（必须挂 `application_id`） |
| PATCH/DELETE | `/api/job-track/feedbacks/{feedback_id}` | 更新 / 删除反馈 |
| GET/POST | `/api/job-track/interviews`（GET 可带 `application_id`） | 面试复盘 |
| GET/PATCH/DELETE | `/api/job-track/interviews/{session_id}` | 复盘读写删 |
| GET | `/api/job-track/stats` | 看板聚合（`days` 或日期范围），可选 **`resume_filename`**（与列表筛选一致）；含 `by_direction`、`by_resume`、`feedback_distribution`、`interview_sessions_in_window_apps`；初版 **HR/转化率** 见 `*_note` |
| GET | `/api/job-track/ai/coach/latest` | 读取**已保存**的 AI 建议：Query `days`、`resume_filename`（可空=不限定简历）、`focus`（默认「综合复盘与下周策略」）；返回 `found`、`markdown`、`analyzed_at`（即生成时间）、`window`、`jd_analysis_id` 等，与某次 POST 维度一致 |
| POST | `/api/job-track/ai/coach` | 按当前统计窗口生成 Markdown 建议并**写入 `data/job_track.db` 表 `ai_coach_snapshots`**。Body：`days`、`focus`（可选）、`resume_filename`（可选，与投递记录简历文件名一致；空=时间窗内全部投递）、`jd_analysis_id`（可选，挂载 `jd_history` 中单条对标分析节选作补充上下文）；响应含同上元数据 |
| POST | `/api/admin/ingest` | `{ "reset": bool }` 触发索引 |

---

## 本地会产生哪些文件（隐私相关）

| 位置 | 内容 | 默认是否进 Git |
|------|------|----------------|
| **`data/`** | `chroma/` 向量库、`jd_catalog.json`、`jd_history.json`、**`job_track.db`**（求职追踪：**投递 / 环节 / 反馈 / 复盘** 与 **AI 建议快照 `ai_coach_snapshots`**）等 | **否**（已在 `.gitignore`） |
| **`profile/resume_facts_*.md`**、**`RESUME_FACTS.md`** | 真实简历正文 | **否** |
| **`docs/notes/`** | Web 生成的学习笔记 | **否**（已在 `.gitignore`） |
| **`docs/question_banks/`** | 由 JD + 简历材料归纳的题库 | **否**（已在 `.gitignore`） |
| **`docs/*.md`**（设计稿、计划、定稿笔记） | 仓库文档 | **可提交**（按需脱敏） |
| **`profile/demo_facts.md`、`*.example`** | 演示 / 示例 | **可提交** |

首次启动会自动把遗留的 **`resume_facts_uploaded.md`** 按规则重命名为带时间戳的文件；旧的 **`jd_history.json`** 若为合并格式会自动迁移为「JD 资料库 + 分析历史」分拆结构。

---

## Git：建议提交与不提交什么

以下适合 **推送至 Git**（开源或团队仓库时仍建议不包含真实履历与密钥）：

- **源码与界面**：`app/`、`static/`、`run.py`
- **依赖与环境模板**：`requirements.txt`、`.env.example`
- **容器**：`Dockerfile`、`docker-compose.yml`（若项目中有）
- **说明文档**：`README.md`、`DEMO.md`、`docs/` 下的设计、计划类 Markdown（**提交前自行检查是否含隐私**）

**不要提交**（已由 `.gitignore` 覆盖或强烈建议勿提交）：

- **`.env`** 及任意含真实 Key 的文件
- **`data/`**（向量库与 JD/分析 JSON）
- **`profile/resume_facts_*.md`、`profile/RESUME_FACTS.md`**
- **`docs/notes/`、`docs/question_banks/`**
- **`__pycache__/`、`.venv/`**

若某类目录曾被误提交过，需要从索引移除但保留本地文件时可以使用：

```bash
git rm -r --cached data/ docs/notes/ docs/question_banks/
```

（按实际路径调整；之后再 `git commit`。）

可选提交：仓库内你自己写的 **可与公开分享的**学习笔记可复制到例如 `docs/notes_publish/` 等非忽略路径后再提交——**不要将 `docs/notes/` 中与隐私相关的自动生成文件强行加入版本库**。

---

## Docker

```bash
cp .env.example .env && vim .env
docker compose build
docker compose up -d

docker compose exec findaijob python -m app.rag.ingest --reset
```

---

## 设计文档与扩展

- 产品：`docs/plans/2026-05-11-ai-resume-qa-assistant-design.md`
- 求职追踪：`docs/plans/job-track-spec.md`
- RAG：`docs/RAG系统设计_定稿.md`
- 面试笔记：`docs/大模型与多模态面试笔记_定稿.md`

---

## 免责声明

本产品仅辅助整理与复述 **你提供的材料**，不替你编造经历。云服务调用受各厂商数据处理条款约束。
