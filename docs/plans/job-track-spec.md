# 求职追踪（Job Track）规格摘要

实现位置：`app/job_track/`、`data/job_track.db`（与 `data/` 下其它文件一样默认不提交）。

## 数据

- **applications**：主表；**company_norm + position_norm** 全库唯一（trim、折叠空白、ASCII 大小写不敏感）；含 `applied_on`、`abandoned`、`jd_keywords`、`jd_keywords_user_edited` 等。
- **application_stages**：每行一案一环节，`outcome ∈ {pending, passed, failed}`。
- **feedbacks** / **interview_sessions**：外键 CASCADE 到 `applications`；复盘须带合法的 `stage`（与环节链一致）。
- **推进**：仅在 **未放弃** 时，若某环节设为 `passed`，下一环节自动 `pending`。允许跳过中间态（由内推等方式手工标后面环节）。
- **放弃**：`abandoned=1` 后不再自动推进；**不改变**既有环节结论；统计上仍可依环节聚合（如一面通过率）。
- **关键词**：用户对 `jd_keywords` 做过 PATCH 后 `jd_keywords_user_edited=1`，拒绝「生成草稿」覆盖。
- **`ai_coach_snapshots`**：AI 教练输出的历史快照；查询「最新」时按 `days` + `focus` + `resume_filename` 筛选，与 `POST /api/job-track/ai/coach` 入参维度一致。

## 环节链（固定）

`简历投递 → HR沟通 → 一面 → 二面 → 终面 → Offer环节`

新建投递时仅为 **简历投递** 写入一行，`pending`。

## 统计与时间窗

- **投递日期**：`applications.applied_on`（`YYYY-MM-DD`，按浏览器/服务端**本地日历**理解与筛选；API 聚合与默认 `days` 一致）。
- **一面通过率**：分母为一面 `passed|failed`，分子为一面 `passed`（不因放弃抹掉已形成结论）。
- **HR 回复率 / 面试转化率**：当前为 **初版启发式**（详见 `GET /api/job-track/stats` 响应中的 `_note` 字段），可后续改成与 HR 环节严格对齐的规则。

## 前端

静态页 Tab **求职追踪**：列表、详情、环节下拉、反馈/复盘简报、简易指标与 **AI 建议**。

- **AI 建议**：与 JD 对标分析类似，结果落在 SQLite 表 **`ai_coach_snapshots`**（字段含 `resume_filename`、`days`、`focus`、`applied_from`/`applied_to`、`markdown`、`created_at`，可选 `jd_analysis_id`）。**简历维度与页顶筛选一致**——调用 **`GET /api/job-track/ai/coach/latest`** / **`POST /api/job-track/ai/coach`** 时使用与 **`GET .../applications`、`GET .../stats`** 相同的 `resume_filename`（可空）。**不再用浏览器 localStorage** 作为主存储。**「重新生成」**写入新快照。
- **看板**：顶部工具栏选择 **投递时间窗 + 简历** 后，列表、`GET /stats` 与 AI 建议使用同一 **`resume_filename`**。**岗位详情内仅只读展示本条投递的简历**，不提供简历下拉修改；顶部为「全部投递」时列表项副标题附带简历简短名。**总指标下方仍可展开**按岗位方向 / 简历版本 / 反馈类型的表格及复盘条数说明。
- **明细**：每条反馈、每场复盘支持 **删除**；复盘条目可展开查看问题列表（含 weak 标记）、失败推测与改进；新建复盘支持拆分「常规问题」「答得不理想」两行输入。