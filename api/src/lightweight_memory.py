import json
import logging
import os
import pathlib
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List

from src.lexical_search import build_match_query


logger = logging.getLogger(__name__)

SCRIPT_DIR = pathlib.Path(__file__).parent.parent
DEFAULT_MEMORY_DB_PATH = pathlib.Path(
    os.getenv(
        "LIGHTWEIGHT_MEMORY_DB_PATH",
        SCRIPT_DIR / "data" / "memory" / "lightweight_memory.sqlite3",
    )
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


class LightweightMemoryStore:
    def __init__(self, db_path: pathlib.Path | str | None = None):
        self.db_path = pathlib.Path(db_path or DEFAULT_MEMORY_DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ensure_schema()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def ensure_schema(self) -> None:
        connection = self.connect()
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS working_memory_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    user_message TEXT NOT NULL,
                    search_query TEXT,
                    label TEXT,
                    description_json TEXT NOT NULL,
                    response_text TEXT NOT NULL,
                    sources_json TEXT NOT NULL,
                    history_entry_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_working_memory_session_created
                ON working_memory_entries(session_id, created_at DESC)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS episodic_memories (
                    episode_id TEXT PRIMARY KEY,
                    case_ref TEXT,
                    role TEXT,
                    label TEXT,
                    summary TEXT NOT NULL,
                    corrections_json TEXT NOT NULL,
                    sources_json TEXT NOT NULL,
                    superseded_by TEXT,
                    validated INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS episodic_memories_fts
                USING fts5(
                    episode_id UNINDEXED,
                    case_ref,
                    label,
                    summary,
                    corrections,
                    tokenize = 'unicode61 remove_diacritics 2'
                )
                """
            )
        connection.close()

    def remember_working_memory(
        self,
        *,
        session_id: str,
        role: str,
        user_message: str,
        search_query: str | None,
        label: str | None,
        description: Any,
        response_text: str | None,
        sources: Dict[str, Any] | None,
    ) -> None:
        history_entry = [
            {
                "role": role,
                "label": label,
                "description": description,
                "response_text": response_text,
            }
        ]
        connection = self.connect()
        with connection:
            connection.execute(
                """
                INSERT INTO working_memory_entries(
                    session_id,
                    role,
                    user_message,
                    search_query,
                    label,
                    description_json,
                    response_text,
                    sources_json,
                    history_entry_json,
                    created_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    role,
                    user_message,
                    search_query,
                    label,
                    json_dumps(description),
                    response_text or "",
                    json_dumps(sources),
                    json_dumps(history_entry),
                    utc_now_iso(),
                ),
            )
        connection.close()

    def read_working_memory(self, session_id: str, *, limit: int = 4) -> Dict[str, Any]:
        connection = self.connect()
        rows = connection.execute(
            """
            SELECT *
            FROM working_memory_entries
            WHERE session_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
        connection.close()

        if not rows:
            return {
                "session_id": session_id,
                "retained_sources": {},
                "recent_history": [],
                "updated_at": None,
            }

        newest = rows[0]
        recent_history = [
            json_loads(row["history_entry_json"], [])
            for row in reversed(rows)
        ]
        return {
            "session_id": session_id,
            "retained_sources": json_loads(newest["sources_json"], {}),
            "recent_history": recent_history,
            "updated_at": newest["created_at"],
        }

    def write_validated_episode(
        self,
        *,
        episode_id: str,
        case_ref: str | None,
        role: str | None,
        label: str | None,
        summary: str,
        corrections: Any,
        sources: Dict[str, Any] | None,
        validated: bool,
        supersedes: str | None = None,
    ) -> bool:
        if not validated:
            logger.info("Skipping episodic memory write for %s because validated=false", episode_id)
            return False

        timestamp = utc_now_iso()
        corrections_payload = json_dumps(corrections if corrections is not None else [])
        sources_payload = json_dumps(sources)
        connection = self.connect()
        with connection:
            connection.execute(
                """
                INSERT INTO episodic_memories(
                    episode_id,
                    case_ref,
                    role,
                    label,
                    summary,
                    corrections_json,
                    sources_json,
                    superseded_by,
                    validated,
                    created_at,
                    updated_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
                ON CONFLICT(episode_id) DO UPDATE SET
                    case_ref = excluded.case_ref,
                    role = excluded.role,
                    label = excluded.label,
                    summary = excluded.summary,
                    corrections_json = excluded.corrections_json,
                    sources_json = excluded.sources_json,
                    updated_at = excluded.updated_at,
                    validated = 1
                """,
                (
                    episode_id,
                    case_ref,
                    role,
                    label,
                    summary,
                    corrections_payload,
                    sources_payload,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                "DELETE FROM episodic_memories_fts WHERE episode_id = ?",
                (episode_id,),
            )
            connection.execute(
                """
                INSERT INTO episodic_memories_fts(
                    episode_id,
                    case_ref,
                    label,
                    summary,
                    corrections
                )
                VALUES(?, ?, ?, ?, ?)
                """,
                (
                    episode_id,
                    case_ref or "",
                    label or "",
                    summary,
                    corrections_payload,
                ),
            )
            if supersedes:
                connection.execute(
                    """
                    UPDATE episodic_memories
                    SET superseded_by = ?, updated_at = ?
                    WHERE episode_id = ?
                    """,
                    (episode_id, timestamp, supersedes),
                )
        connection.close()
        return True

    def search_episodic_memory(self, query: str, *, limit: int = 5) -> List[Dict[str, Any]]:
        match_query = build_match_query(query, operator="AND")
        if not match_query:
            return []

        connection = self.connect()

        def fetch(current_match_query: str):
            return connection.execute(
                """
                SELECT
                    m.episode_id,
                    m.case_ref,
                    m.role,
                    m.label,
                    m.summary,
                    m.corrections_json,
                    m.sources_json,
                    bm25(episodic_memories_fts, 6.0, 4.0, 2.0, 1.0) AS bm25_score
                FROM episodic_memories_fts
                JOIN episodic_memories AS m
                  ON m.episode_id = episodic_memories_fts.episode_id
                WHERE episodic_memories_fts MATCH ?
                  AND m.validated = 1
                  AND m.superseded_by IS NULL
                ORDER BY bm25_score ASC, m.updated_at DESC
                LIMIT ?
                """,
                (current_match_query, limit),
            ).fetchall()

        rows = fetch(match_query)
        if not rows and " AND " in match_query:
            rows = fetch(build_match_query(query, operator="OR"))
        connection.close()

        results: List[Dict[str, Any]] = []
        for rank, row in enumerate(rows, start=1):
            results.append(
                {
                    "doc": f"EPISODIC-{row['episode_id']}",
                    "chunk_id": row["episode_id"],
                    "content": row["summary"],
                    "label": row["label"],
                    "role": row["role"],
                    "case_ref": row["case_ref"],
                    "memory_type": "episodic",
                    "bm25_score": row["bm25_score"],
                    "lexical_rank": rank,
                    "sources": json_loads(row["sources_json"], {}),
                    "corrections": json_loads(row["corrections_json"], []),
                }
            )
        return results
