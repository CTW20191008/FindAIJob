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
输出必须是 JSON，包含以下字段：
- score: integer 0-100，综合匹配度评分（仅基于材料中有据可查的经历）
- summary: string 一句话总体评价（30字以内）
- match_points: string[] 简历与 JD 的匹配点，每条具体说明匹配了哪个要求
- gaps: string[] 简历中缺少或薄弱的能力/经历，指出 JD 中哪条要求未被满足
- suggestions: string[] 针对缺口的可操作建议，包括：面试中如何弥补表述、可补充的项目/证明材料、短期提升方向
- risks: string[] 候选人可能被质疑或需澄清的点
不要编造简历中未出现的经历；不确定的内容写进 risks。"""


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
    data.setdefault("score", None)
    data.setdefault("summary", "")
    for k in ("match_points", "gaps", "suggestions", "risks"):
        data.setdefault(k, [])
    return data, cites


SYSTEM_CMP = """你是专业面试评估教练。对候选人的回答进行客观点评。
输出必须是 JSON：
{
  "score": 整数 0-10（10分满分），
  "level": "优秀|良好|一般|需加强",
  "strengths": ["亮点1", "亮点2"],
  "gaps": ["不足1", "不足2"],
  "suggestions": ["改进建议1", "改进建议2"],
  "sample_points": ["参考答案中应涵盖的关键点1", "关键点2"]
}
规则：
1) 结合【参考提示】客观评分，不因字数多少而偏颇；
2) 亮点/不足/建议每项 1-3 条，简洁具体；
3) 若用户未作答，score=0 并在 suggestions 中给出破题思路。"""


async def compare_answer(
    question: str,
    user_answer: str,
    hint: str,
) -> dict:
    from app.llm import chat_complete, safe_json_extract

    messages = [
        {"role": "system", "content": SYSTEM_CMP},
        {
            "role": "user",
            "content": (
                f"【面试题】\n{question}\n\n"
                f"【参考提示】\n{hint or '（无）'}\n\n"
                f"【候选人回答】\n{user_answer or '（未作答）'}\n\n只输出 JSON。"
            ),
        },
    ]
    raw = await chat_complete(messages, temperature=0.1)
    data = safe_json_extract(raw)
    if not isinstance(data, dict):
        data = {"score": 0, "level": "—", "strengths": [], "gaps": [], "suggestions": [], "sample_points": []}
    for k in ("strengths", "gaps", "suggestions", "sample_points"):
        data.setdefault(k, [])
    data.setdefault("score", 0)
    data.setdefault("level", "—")
    return data


SYSTEM_QB = """你是资深面试教练。根据【招聘 JD】和【候选人简历材料】生成一份系统性题库。

输出必须是 JSON，结构如下：
{
  "title": "题库标题（公司·岗位）",
  "categories": [
    {
      "name": "分类名称（如：算法基础、项目深挖、系统设计、行为面试等）",
      "questions": [
        {
          "question": "面试题",
          "intent": "考察点",
          "answer": "参考回答（结合候选人材料，100-200字）",
          "keywords": ["关键词1", "关键词2"]
        }
      ]
    }
  ]
}

规则：
1) 分类必须覆盖 JD 的核心要求，3-6 个分类，每类 3-5 题；
2) 参考回答必须结合候选人材料中的真实项目/经历，禁止编造；
3) 材料不足时，answer 中注明「建议补充：xxx」。"""


async def generate_question_bank(
    jd_text: str, company: str, position: str, hits: list
) -> dict:
    from app.llm import chat_complete, safe_json_extract

    if not hits:
        return {
            "title": f"{company}·{position}",
            "categories": [],
            "error": "知识库无可用简历片段，请先上传简历并建立索引",
        }

    ctx, _ = format_context(hits)
    messages = [
        {"role": "system", "content": SYSTEM_QB},
        {
            "role": "user",
            "content": (
                f"【招聘 JD】\n{jd_text}\n\n"
                f"公司：{company}  岗位：{position}\n\n"
                f"【候选人简历材料】\n{ctx}\n\n只输出 JSON。"
            ),
        },
    ]
    raw = await chat_complete(messages, temperature=0.2, max_tokens=6000)
    data = safe_json_extract(raw)
    if not isinstance(data, dict):
        data = {"title": f"{company}·{position}", "categories": [], "raw": raw}
    data.setdefault("title", f"{company}·{position}")
    data.setdefault("categories", [])
    return data


def question_bank_to_markdown(
    data: dict, company: str, position: str, entry_id: str, generated_at: str
) -> str:
    lines = [
        f"# 题库：{company} · {position}",
        f"",
        f"> 生成时间：{generated_at}  ",
        f"> JD 来源：{company} · {position}",
        f"",
    ]
    for cat in data.get("categories", []):
        lines.append(f"## {cat.get('name', '其他')}")
        lines.append("")
        for i, q in enumerate(cat.get("questions", []), 1):
            lines.append(f"### Q{i}：{q.get('question', '')}")
            lines.append("")
            if q.get("intent"):
                lines.append(f"**考察点**：{q['intent']}")
                lines.append("")
            if q.get("answer"):
                lines.append(f"**参考回答**：{q['answer']}")
                lines.append("")
            if q.get("keywords"):
                lines.append(f"**关键词**：{', '.join(q['keywords'])}")
                lines.append("")
            lines.append("---")
            lines.append("")
    return "\n".join(lines)


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
