#!/usr/bin/env python3
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.lexical_search import (
    NC_LEXICAL_CONFIG,
    TECH_DOCS_LEXICAL_CONFIG,
    LexicalCorpusConfig,
    build_match_query,
    rebuild_lexical_index,
    search_documents_lexical,
    search_lexical_corpus,
    search_non_conformities_lexical,
)


def assert_temp_corpus_behavior() -> None:
    assert build_match_query("ATA-28 hydraulic leak") == "ata* AND 28* AND hydraulic* AND leak*"

    with TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        corpus_root = tmp_path / "corpus"
        corpus_root.mkdir(parents=True)
        (corpus_root / "ATA-28-hydraulic-leak.md").write_text(
            "Hydraulic leak detected near ATA 28 fuel system access panel.",
            encoding="utf-8",
        )
        (corpus_root / "ATA-21-cabin-pressure.md").write_text(
            "Cabin pressure issue reported under ATA 21 environmental control system.",
            encoding="utf-8",
        )

        config = LexicalCorpusConfig(
            name="tmp",
            source_root=corpus_root,
            file_glob="*.md",
            db_path=tmp_path / "lexical" / "fts.sqlite3",
        )

        summary = rebuild_lexical_index(config)
        assert summary["rebuilt"] is True
        assert summary["document_count"] == 2
        hits = search_lexical_corpus(config, "ATA 28 hydraulic leak", limit=2)
        assert hits[0]["doc"] == "ATA-28-hydraulic-leak.md"


def ensure_default_index(config: LexicalCorpusConfig) -> dict:
    if config.db_path.exists():
        return {
            "corpus": config.name,
            "db_path": str(config.db_path),
            "rebuilt": False,
        }
    return rebuild_lexical_index(config)


def assert_default_corpus_queries() -> None:
    tech_summary = ensure_default_index(TECH_DOCS_LEXICAL_CONFIG)
    nc_summary = ensure_default_index(NC_LEXICAL_CONFIG)

    tech_hits = search_documents_lexical("supplier quality requirements", 3)
    nc_hits = search_non_conformities_lexical("ATA 28 hydraulic leak", 3)

    assert tech_hits, "tech docs lexical query returned no hits"
    assert nc_hits, "non-conformities lexical query returned no hits"

    print(
        {
            "tech_docs": tech_summary,
            "tech_top_docs": [row["doc"] for row in tech_hits[:3]],
            "non_conformities": nc_summary,
            "nc_top_docs": [row["doc"] for row in nc_hits[:3]],
        }
    )


def main() -> None:
    assert_temp_corpus_behavior()
    assert_default_corpus_queries()


if __name__ == "__main__":
    main()
