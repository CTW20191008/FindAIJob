"""求职追踪统计。（HR 回复率 / 面试转化率为初版启发式，常量在函数内收口便于迭代。）"""
from __future__ import annotations

import sqlite3
from collections import Counter
from typing import Any, Optional

from app.job_track.constants import OUTCOME_FAILED, OUTCOME_PASSED, PIPELINE_STAGES
from app.job_track.db import get_connection


FIRST_ROUND = "一面"
APP_STAGE = "简历投递"


def _stage_map(conn: sqlite3.Connection) -> dict[str, dict[str, str]]:
    """application_id -> {stage: outcome}"""
    cur = conn.execute(
        "SELECT application_id, stage, outcome FROM application_stages",
    )
    m: dict[str, dict[str, str]] = {}
    for aid, stage, outcome in cur.fetchall():
        m.setdefault(str(aid), {})[str(stage)] = str(outcome)
    return m


def _apps_in_window(conn: sqlite3.Connection, applied_from: str, applied_to: str) -> list[sqlite3.Row]:
    cur = conn.execute(
        """SELECT * FROM applications
           WHERE applied_on >= ? AND applied_on <= ?
           ORDER BY applied_on DESC""",
        (applied_from, applied_to),
    )
    return list(cur.fetchall())


def aggregate_stats(applied_from: str, applied_to: str, *, resume_filename: Optional[str] = None) -> dict[str, Any]:
    conn = get_connection()
    try:
        apps_all = _apps_in_window(conn, applied_from, applied_to)
        if resume_filename and resume_filename.strip():
            rf = resume_filename.strip()
            apps = [a for a in apps_all if (a["resume_filename"] or "").strip() == rf]
        else:
            apps = apps_all
        smap = _stage_map(conn)

        total = len(apps)

        def st(aid: str, stage: str) -> Optional[str]:
            return smap.get(aid, {}).get(stage)

        # —— HR 回复率（初版）：简历投递已过评估（passed / failed）
        hr_denom = total
        hr_num = sum(1 for a in apps if st(a["id"], APP_STAGE) in (OUTCOME_PASSED, OUTCOME_FAILED))

        # —— 面试转化率（初版）：已进入「一面」环节（表中存在任意 outcome）
        iv_denom = total
        iv_num = sum(1 for a in apps if st(a["id"], FIRST_ROUND) is not None)

        # —— 一面通过率：一面已有 passed/failed；分子一面 passed
        fr_denom = sum(
            1 for a in apps if st(a["id"], FIRST_ROUND) in (OUTCOME_PASSED, OUTCOME_FAILED)
        )
        fr_num = sum(1 for a in apps if st(a["id"], FIRST_ROUND) == OUTCOME_PASSED)

        def rate(num: float, denom: float) -> Optional[float]:
            if denom <= 0:
                return None
            return round(100.0 * num / denom, 2)

        # 按岗位方向
        dir_counts: dict[str, int] = {}
        dir_first_denom: dict[str, int] = {}
        dir_first_num: dict[str, int] = {}
        for a in apps:
            d = a["direction"] or "未知"
            dir_counts[d] = dir_counts.get(d, 0) + 1
            aid = a["id"]
            if st(aid, FIRST_ROUND) in (OUTCOME_PASSED, OUTCOME_FAILED):
                dir_first_denom[d] = dir_first_denom.get(d, 0) + 1
                if st(aid, FIRST_ROUND) == OUTCOME_PASSED:
                    dir_first_num[d] = dir_first_num.get(d, 0) + 1

        dir_breakdown = []
        for d, cnt in sorted(dir_counts.items(), key=lambda x: -x[1]):
            dd = dir_first_denom.get(d, 0)
            dn = dir_first_num.get(d, 0)
            dir_breakdown.append(
                {
                    "direction": d,
                    "applications": cnt,
                    "first_round_pass_rate": rate(dn, dd),
                    "first_round_denominator": dd,
                    "first_round_numerator": dn,
                }
            )

        # 按简历版本
        rf_map: dict[str, int] = {}
        rf_denom_map: dict[str, int] = {}
        rf_num_map: dict[str, int] = {}
        for a in apps:
            rf = (a["resume_filename"] or "").strip() or "（未填）"
            rf_map[rf] = rf_map.get(rf, 0) + 1
            aid = a["id"]
            if st(aid, FIRST_ROUND) in (OUTCOME_PASSED, OUTCOME_FAILED):
                rf_denom_map[rf] = rf_denom_map.get(rf, 0) + 1
                if st(aid, FIRST_ROUND) == OUTCOME_PASSED:
                    rf_num_map[rf] = rf_num_map.get(rf, 0) + 1

        resume_breakdown = []
        for rf, cnt in sorted(rf_map.items(), key=lambda x: -x[1]):
            dd = rf_denom_map.get(rf, 0)
            dn = rf_num_map.get(rf, 0)
            resume_breakdown.append(
                {
                    "resume_filename": rf,
                    "applications": cnt,
                    "first_round_pass_rate": rate(dn, dd),
                    "first_round_denominator": dd,
                    "first_round_numerator": dn,
                }
            )

        app_ids = [str(a["id"]) for a in apps]
        feedback_distribution: list[dict[str, Any]] = []
        interview_session_count = 0
        if app_ids:
            placeholders = ",".join("?" * len(app_ids))
            cur_fb = conn.execute(
                f"SELECT feedback_type FROM feedbacks WHERE application_id IN ({placeholders})",
                app_ids,
            )
            fb_ctr = Counter(str(row[0]) for row in cur_fb.fetchall())
            feedback_distribution = [
                {"feedback_type": k, "count": v} for k, v in fb_ctr.most_common()
            ]
            cur_iv = conn.execute(
                f"SELECT COUNT(*) FROM interview_sessions WHERE application_id IN ({placeholders})",
                app_ids,
            )
            row_iv = cur_iv.fetchone()
            interview_session_count = int(row_iv[0]) if row_iv else 0

        return {
            "applied_from": applied_from,
            "applied_to": applied_to,
            "total_applications": total,
            "hr_reply_rate": rate(hr_num, hr_denom),
            "hr_reply_numerator": hr_num,
            "hr_reply_denominator": hr_denom,
            "hr_reply_note": "初版：「简历投递」环节为 passed 或 failed 视为获得反馈（可后续改为 HR 环节口径）",
            "interview_conversion_rate": rate(iv_num, iv_denom),
            "interview_conversion_numerator": iv_num,
            "interview_conversion_denominator": iv_denom,
            "interview_conversion_note": "初版：已存在「一面」环节记录即视为进入面试流程",
            "first_round_pass_rate": rate(fr_num, fr_denom),
            "first_round_numerator": fr_num,
            "first_round_denominator": fr_denom,
            "by_direction": dir_breakdown,
            "by_resume": resume_breakdown,
            "feedback_distribution": feedback_distribution,
            "feedback_distribution_note": "时间窗内投递记录关联的全部反馈条目，按「反馈类型」计数",
            "interview_sessions_in_window_apps": interview_session_count,
            "interview_sessions_note": "同上批投递记录名下的复盘条数之和",
            "pipeline_stages": list(PIPELINE_STAGES),
        }
    finally:
        conn.close()
