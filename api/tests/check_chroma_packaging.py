#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"
CORPORA = ("a220-tech-docs", "a220-non-conformities")


def load_segment_rows(db_path: Path) -> list[dict]:
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "select id, type, scope from segments order by scope, id"
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "id": segment_id,
            "type": segment_type,
            "scope": scope,
        }
        for segment_id, segment_type, scope in rows
    ]


def build_report() -> dict:
    report: dict[str, dict] = {}
    for corpus in CORPORA:
        vectordb_root = DATA_ROOT / corpus / "vectordb"
        db_path = vectordb_root / "chroma.sqlite3"
        segments = load_segment_rows(db_path)
        vector_segments = [
            segment
            for segment in segments
            if segment["scope"] == "VECTOR"
            and segment["type"].endswith("hnsw-local-persisted")
        ]
        metadata_segments = [
            segment for segment in segments if segment["scope"] == "METADATA"
        ]
        local_missing = [
            segment["id"]
            for segment in vector_segments
            if not (vectordb_root / segment["id"]).is_dir()
        ]
        sqlite_only_missing = [segment["id"] for segment in vector_segments]
        report[corpus] = {
            "db_path": str(db_path.relative_to(ROOT)),
            "vector_segments": vector_segments,
            "metadata_segments": metadata_segments,
            "local_vector_segment_dirs_present": len(local_missing) == 0,
            "sqlite_only_snapshot_would_be_missing": sqlite_only_missing,
        }
    return report


def main() -> None:
    report = build_report()

    for corpus, item in report.items():
        vector_segments = item["vector_segments"]
        assert vector_segments, f"{corpus}: no VECTOR segment found in sqlite metadata"
        assert (
            item["local_vector_segment_dirs_present"] is True
        ), f"{corpus}: local vectordb is already missing vector segment directories"
        assert item["sqlite_only_snapshot_would_be_missing"], (
            f"{corpus}: sqlite-only snapshot unexpectedly preserves vector segments"
        )

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
