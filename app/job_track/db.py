from __future__ import annotations

import sqlite3
from pathlib import Path

from app.config import settings


def db_path() -> Path:
    p = settings.chroma_dir.parent / "job_track.db"
    return p.resolve()


def get_connection() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS applications (
              id TEXT PRIMARY KEY,
              company TEXT NOT NULL,
              position TEXT NOT NULL,
              company_norm TEXT NOT NULL,
              position_norm TEXT NOT NULL,
              direction TEXT NOT NULL,
              platform TEXT NOT NULL DEFAULT '',
              applied_on TEXT NOT NULL,
              location TEXT NOT NULL DEFAULT '',
              salary_range TEXT NOT NULL DEFAULT '',
              resume_filename TEXT NOT NULL DEFAULT '',
              jd_catalog_id TEXT,
              jd_text TEXT NOT NULL DEFAULT '',
              jd_keywords TEXT NOT NULL DEFAULT '',
              jd_keywords_user_edited INTEGER NOT NULL DEFAULT 0,
              notes TEXT NOT NULL DEFAULT '',
              abandoned INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(company_norm, position_norm)
            );

            CREATE TABLE IF NOT EXISTS application_stages (
              application_id TEXT NOT NULL,
              stage TEXT NOT NULL,
              outcome TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (application_id, stage),
              FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS feedbacks (
              id TEXT PRIMARY KEY,
              application_id TEXT NOT NULL,
              source TEXT NOT NULL,
              happened_at TEXT NOT NULL,
              content TEXT NOT NULL,
              feedback_type TEXT NOT NULL,
              trustworthy INTEGER,
              next_action TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS interview_sessions (
              id TEXT PRIMARY KEY,
              application_id TEXT NOT NULL,
              stage TEXT NOT NULL,
              interview_on TEXT NOT NULL,
              duration_min INTEGER,
              interviewer_type TEXT NOT NULL DEFAULT '',
              questions_json TEXT NOT NULL DEFAULT '[]',
              result TEXT NOT NULL DEFAULT '',
              failure_guess TEXT NOT NULL DEFAULT '',
              improvements TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_applications_applied ON applications(applied_on);
            CREATE INDEX IF NOT EXISTS idx_applications_direction ON applications(direction);
            CREATE INDEX IF NOT EXISTS idx_feedbacks_app ON feedbacks(application_id);
            CREATE INDEX IF NOT EXISTS idx_iv_app ON interview_sessions(application_id);

            CREATE TABLE IF NOT EXISTS ai_coach_snapshots (
              id TEXT PRIMARY KEY,
              resume_filename TEXT NOT NULL DEFAULT '',
              jd_analysis_id TEXT,
              days INTEGER NOT NULL,
              focus TEXT NOT NULL DEFAULT '',
              applied_from TEXT NOT NULL,
              applied_to TEXT NOT NULL,
              markdown TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_coach_latest ON ai_coach_snapshots (resume_filename, days, focus, created_at DESC);
            """
        )
        conn.commit()
    finally:
        conn.close()
