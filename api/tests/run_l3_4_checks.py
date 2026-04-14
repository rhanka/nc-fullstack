#!/usr/bin/env python3
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
API_ROOT = ROOT.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from src.lightweight_memory import LightweightMemoryStore


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="nc-memory-") as tmp_dir:
        db_path = pathlib.Path(tmp_dir) / "lightweight_memory.sqlite3"
        store = LightweightMemoryStore(db_path)

        store.remember_working_memory(
            session_id="session-a",
            role="000",
            user_message="first issue",
            search_query="fuel tank issue",
            label="Fuel tank issue",
            description={"synthesis": "first"},
            response_text="Initial description",
            sources={"tech_docs": {"sources": [{"doc": "doc-a"}]}},
        )
        store.remember_working_memory(
            session_id="session-a",
            role="100",
            user_message="second issue",
            search_query="fuel tank grounding",
            label="Fuel tank grounding issue",
            description={"synthesis": "second"},
            response_text="Analysis",
            sources={"non_conformities": {"sources": [{"doc": "nc-a"}]}},
        )

        session_memory = store.read_working_memory("session-a")
        assert session_memory["session_id"] == "session-a"
        assert len(session_memory["recent_history"]) == 2
        assert session_memory["retained_sources"]["non_conformities"]["sources"][0]["doc"] == "nc-a"

        skipped = store.write_validated_episode(
            episode_id="episode-draft",
            case_ref="NC-DRAFT",
            role="100",
            label="Draft only",
            summary="draft summary fuel tank grounding",
            corrections={"note": "draft"},
            sources={"non_conformities": {"sources": []}},
            validated=False,
        )
        assert skipped is False
        assert store.search_episodic_memory("fuel tank grounding", limit=5) == []

        stored = store.write_validated_episode(
            episode_id="episode-v1",
            case_ref="NC-VALID",
            role="100",
            label="Validated fuel grounding",
            summary="validated fuel tank grounding wiring issue",
            corrections={"note": "validated"},
            sources={"non_conformities": {"sources": [{"doc": "ATA-28-hit"}]}},
            validated=True,
        )
        assert stored is True

        hits = store.search_episodic_memory("fuel tank grounding", limit=5)
        assert hits
        assert hits[0]["chunk_id"] == "episode-v1"
        assert hits[0]["memory_type"] == "episodic"

        superseded = store.write_validated_episode(
            episode_id="episode-v2",
            case_ref="NC-VALID",
            role="100",
            label="Validated fuel grounding updated",
            summary="validated fuel tank grounding wiring issue updated",
            corrections={"note": "validated updated"},
            sources={"non_conformities": {"sources": [{"doc": "ATA-28-hit-v2"}]}},
            validated=True,
            supersedes="episode-v1",
        )
        assert superseded is True

        updated_hits = store.search_episodic_memory("fuel tank grounding", limit=5)
        assert updated_hits
        assert updated_hits[0]["chunk_id"] == "episode-v2"
        assert all(hit["chunk_id"] != "episode-v1" for hit in updated_hits)

    print("l3.4 lightweight memory checks: ok")


if __name__ == "__main__":
    main()
