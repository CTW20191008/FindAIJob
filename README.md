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
| POST | `/api/admin/ingest` | `{ "reset": bool }` 触发索引 |

---

## 本地会产生哪些文件（隐私相关）

| 位置 | 内容 | 默认是否进 Git |
|------|------|----------------|
| **`data/`** | `chroma/` 向量库、`jd_catalog.json`、`jd_history.json` 等 | **否**（已在 `.gitignore`） |
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
- RAG：`docs/RAG系统设计_定稿.md`
- 面试笔记：`docs/大模型与多模态面试笔记_定稿.md`

---

## 免责声明

本产品仅辅助整理与复述 **你提供的材料**，不替你编造经历。云服务调用受各厂商数据处理条款约束。
