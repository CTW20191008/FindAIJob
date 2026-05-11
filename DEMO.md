# Demo / 录屏指引

本项目需求中的 **「在线 Demo 或录屏」**：代码无法替你托管公网域名，可按下列其一完成交付。

## 选项 A：在线 Demo（自建）

1. 准备 VPS / PaaS（如 Railway、Render、Fly.io、阿里云 ECS 等），监听 **HTTPS**（Caddy / Nginx 反代）。
2. 仓库根配置 `.env`：`OPENAI_*`、`FINDAIJOB_API_SECRET`（必选）。
3. `docker compose up -d`，再执行一次：`docker compose exec findaijob python -m app.rag.ingest --reset`。
4. 在安全组放行 **8848**（或由反代只开放 443）。
5. 将公网首页 URL **写在此处或 README 醒目位置**：  
   - **演示地址**：`_在此粘贴你的 HTTPS URL，例如 https://resume-demo.example.com/_`

注意：不要把 **真实履历** `RESUME_FACTS.md` 推送到公开仓库；公网仅用 **demo_facts.md** 或脱敏文案。

## 选项 B：录屏（离线演示）

使用手机或桌面录屏：

1. 本地 `python run.py`，浏览器打开 `/`；
2. 演示：**索引页执行 ingest → 问答 → 粘贴虚构 JD → 生成面试题**；
3. 导出 mp4/gif，放到图床或与本仓库同属的私有云盘；
4. 在 README 「在线 Demo」行链到录屏：  
   - **录屏**：`_粘贴 Loom / 哔哩哔哩 / Cloud 磁盘链接_`

推荐时长：**2～4 分钟**，突出 RAG 引用与 JD 结构化输出。

## 选项 C：内网穿透（临时 Demo）

可使用 **Cloudflare Tunnel / ngrok** 将本机 **8848** 暴露 HTTPS，同样需要 `FINDAIJOB_API_SECRET` 与短时有效的 Key，演示结束关闭隧道。

---

**合规**：对他人展示前请遮蔽 API Key、真实简历信息与真实 JD 中的招聘方联系人。
