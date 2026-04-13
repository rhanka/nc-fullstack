from pathlib import Path

from src.lexical_search import (
    LexicalCorpusConfig,
    build_match_query,
    rebuild_lexical_index,
    search_lexical_corpus,
)


def test_build_match_query_normalizes_and_prefixes_tokens() -> None:
    assert build_match_query("ATA-28 hydraulic leak") == "ata* AND 28* AND hydraulic* AND leak*"
    assert build_match_query("   ") == ""


def test_rebuild_and_search_lexical_index(tmp_path: Path) -> None:
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
        name="test",
        source_root=corpus_root,
        file_glob="*.md",
        db_path=tmp_path / "lexical" / "fts.sqlite3",
    )

    first_build = rebuild_lexical_index(config)
    assert first_build["rebuilt"] is True
    assert first_build["document_count"] == 2
    assert config.db_path.exists()

    second_build = rebuild_lexical_index(config)
    assert second_build["rebuilt"] is False
    assert second_build["fingerprint"] == first_build["fingerprint"]

    hits = search_lexical_corpus(config, "ATA 28 hydraulic leak", limit=2)
    assert hits
    assert hits[0]["doc"] == "ATA-28-hydraulic-leak.md"
    assert hits[0]["lexical_rank"] == 1
    assert hits[0]["match_query"] == "ata* AND 28* AND hydraulic* AND leak*"
