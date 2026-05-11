from __future__ import annotations

SYSTEM_QA = """你是求职辅助助手，必须严格根据【上下文片段】作答。
规则：
1) 仅能使用上下文中的事实；上下文没有的信息要明确说「材料中未提及」，禁止编造履历或数据。
2) 回答末了用简短列表列出引用：每条写 chunk_id、文档路径、小节标题。
3) 用语简洁，可操作。"""


def format_context(hits: list) -> tuple[str, list[dict]]:
    blocks = []
    cites = []
    for h in hits:
        block = (
            f"[CONTEXT id={h.cid} source={h.source_path} heading={h.heading_path} "
            f"type={h.doc_type}]\n{h.text}\n[/CONTEXT]"
        )
        blocks.append(block)
        cites.append(
            {
                "chunk_id": h.cid,
                "source_path": h.source_path,
                "heading_path": h.heading_path,
                "doc_type": h.doc_type,
            }
        )
    return "\n\n".join(blocks), cites


async def answer_question(question: str, hits: list) -> tuple[str, list[dict]]:
    from app.llm import chat_complete

    if not hits:
        return "知识库暂无匹配片段（请确认已 ingest，且 profile/RESUME_FACTS.md 等非 example 文档存在）。", []

    ctx, cites = format_context(hits)
    messages = [
        {"role": "system", "content": SYSTEM_QA},
        {
            "role": "user",
            "content": f"用户问题：\n{question}\n\n【上下文片段】\n{ctx}",
        },
    ]
    ans = await chat_complete(messages)
    return ans, cites


SYSTEM_JD = """你是职业发展顾问与技术招聘分析助手。
根据提供的【简历相关材料】与【招聘 JD】做匹配分析。
输出必须是 JSON，键为：
- match_points: string[] 匹配点
- gaps: string[] 能力或经历缺口
- suggestions: string[] 面试表述与补充材料建议
- risks: string[] 风险或需澄清点
不要编造简历中未出现的经历；不确定写进 risks。"""


async def analyze_jd(jd_text: str, hits: list) -> tuple[dict, list[dict]]:
    from app.llm import chat_complete, safe_json_extract

    if not hits:
        return {
            "match_points": [],
            "gaps": ["知识库无可用简历/笔记片段，请维护 profile/RESUME_FACTS.md 后重新索引"],
            "suggestions": [],
            "risks": [],
        }, []

    ctx, cites = format_context(hits)
    messages = [
        {"role": "system", "content": SYSTEM_JD},
        {
            "role": "user",
            "content": f"【招聘 JD】\n{jd_text}\n\n【简历与笔记材料】\n{ctx}\n\n只输出 JSON。",
        },
    ]
    raw = await chat_complete(messages, temperature=0.15)
    data = safe_json_extract(raw)
    if not isinstance(data, dict):
        data = {"raw": raw, "match_points": [], "gaps": [], "suggestions": [], "risks": []}
    for k in ("match_points", "gaps", "suggestions", "risks"):
        data.setdefault(k, [])
    return data, cites


SYSTEM_IVQ = """你是面试官助手。根据材料生成面试题。
规则：
1) 题目应可基于用户材料展开，不要假设材料没有的经历。
2) 输出 JSON：{ "questions": [ { "question": "...", "intent": "考察点", "hint": "回答提示" } ] }
3) 题目数量由用户指定，默认 8 道。"""


async def generate_interview_questions(focus: str, count: int, hits: list) -> tuple[dict, list[dict]]:
    from app.llm import chat_complete, safe_json_extract

    if not hits:
        return {"questions": []}, []

    ctx, cites = format_context(hits)
    messages = [
        {"role": "system", "content": SYSTEM_IVQ},
        {
            "role": "user",
            "content": f"侧重方向：{focus or '综合'}\n题目数量：{count}\n\n材料：\n{ctx}\n\n只输出 JSON。",
        },
    ]
    raw = await chat_complete(messages, temperature=0.35)
    data = safe_json_extract(raw)
    if not isinstance(data, dict):
        data = {"questions": []}
    data.setdefault("questions", [])
    return data, cites
