import argparse
import hashlib
import logging
import pathlib
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List


logger = logging.getLogger(__name__)

SCRIPT_DIR = pathlib.Path(__file__).parent.parent
TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


@dataclass(frozen=True)
class LexicalCorpusConfig:
    name: str
    source_root: pathlib.Path
    file_glob: str
    db_path: pathlib.Path


TECH_DOCS_LEXICAL_CONFIG = LexicalCorpusConfig(
    name="tech_docs",
    source_root=SCRIPT_DIR / "data" / "a220-tech-docs" / "ocr",
    file_glob="*.md",
    db_path=SCRIPT_DIR / "data" / "a220-tech-docs" / "lexical" / "fts.sqlite3",
)

NC_LEXICAL_CONFIG = LexicalCorpusConfig(
    name="non_conformities",
    source_root=SCRIPT_DIR / "data" / "a220-non-conformities" / "md",
    file_glob="*.md",
    db_path=SCRIPT_DIR / "data" / "a220-non-conformities" / "lexical" / "fts.sqlite3",
)

DEFAULT_LEXICAL_CORPORA = {
    TECH_DOCS_LEXICAL_CONFIG.name: TECH_DOCS_LEXICAL_CONFIG,
    NC_LEXICAL_CONFIG.name: NC_LEXICAL_CONFIG,
}


def normalize_text(value: str) -> str:
    return (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


def tokenize_query(value: str) -> List[str]:
    deduped: List[str] = []
    seen = set()
    for token in TOKEN_RE.findall(normalize_text(value)):
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def build_match_query(value: str, *, operator: str = "AND") -> str:
    tokens = tokenize_query(value)
    if not tokens:
        return ""
    joiner = f" {operator} "
    return joiner.join(f"{token}*" for token in tokens)


def iter_corpus_files(config: LexicalCorpusConfig) -> List[pathlib.Path]:
    return sorted(config.source_root.glob(config.file_glob))


def compute_corpus_fingerprint(paths: Iterable[pathlib.Path]) -> Dict[str, Any]:
    digest = hashlib.sha256()
    count = 0
    for path in paths:
        stat = path.stat()
        digest.update(str(path).encode("utf-8"))
        digest.update(str(stat.st_size).encode("utf-8"))
        digest.update(str(stat.st_mtime_ns).encode("utf-8"))
        count += 1
    return {
        "document_count": count,
        "fingerprint": digest.hexdigest(),
    }


def connect_fts(db_path: pathlib.Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS lexical_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS lexical_documents
        USING fts5(
            doc,
            chunk_id,
            content,
            source_path UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2'
        )
        """
    )


def read_meta(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute(
        "SELECT value FROM lexical_meta WHERE key = ?",
        (key,),
    ).fetchone()
    return None if row is None else row["value"]


def write_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO lexical_meta(key, value)
        VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def rebuild_lexical_index(
    config: LexicalCorpusConfig,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    paths = iter_corpus_files(config)
    if not paths:
        raise FileNotFoundError(
            f"No source files found for lexical corpus '{config.name}' in {config.source_root}"
        )

    fingerprint_info = compute_corpus_fingerprint(paths)
    connection = connect_fts(config.db_path)
    ensure_schema(connection)

    existing_fingerprint = read_meta(connection, "fingerprint")
    should_rebuild = force or existing_fingerprint != fingerprint_info["fingerprint"]

    if should_rebuild:
        logger.info("Rebuilding lexical index for %s at %s", config.name, config.db_path)
        with connection:
            connection.execute("DELETE FROM lexical_documents")
            for path in paths:
                connection.execute(
                    """
                    INSERT INTO lexical_documents(doc, chunk_id, content, source_path)
                    VALUES(?, ?, ?, ?)
                    """,
                    (
                        path.name,
                        path.stem,
                        path.read_text(encoding="utf-8", errors="ignore"),
                        str(path),
                    ),
                )
            write_meta(connection, "fingerprint", fingerprint_info["fingerprint"])
            write_meta(connection, "document_count", str(fingerprint_info["document_count"]))
    else:
        logger.info("Lexical index for %s is already up to date", config.name)

    row_count = connection.execute(
        "SELECT COUNT(*) AS count FROM lexical_documents"
    ).fetchone()["count"]
    connection.close()

    return {
        "corpus": config.name,
        "db_path": str(config.db_path),
        "source_root": str(config.source_root),
        "document_count": row_count,
        "fingerprint": fingerprint_info["fingerprint"],
        "rebuilt": should_rebuild,
    }


def ensure_lexical_index_exists(config: LexicalCorpusConfig) -> Dict[str, Any]:
    if not config.db_path.exists():
        return rebuild_lexical_index(config)

    connection = connect_fts(config.db_path)
    ensure_schema(connection)
    row_count = connection.execute(
        "SELECT COUNT(*) AS count FROM lexical_documents"
    ).fetchone()["count"]
    fingerprint = read_meta(connection, "fingerprint")
    connection.close()

    return {
        "corpus": config.name,
        "db_path": str(config.db_path),
        "source_root": str(config.source_root),
        "document_count": row_count,
        "fingerprint": fingerprint,
        "rebuilt": False,
    }


def search_lexical_corpus(
    config: LexicalCorpusConfig,
    query: str,
    *,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    ensure_summary = ensure_lexical_index_exists(config)
    match_query = build_match_query(query, operator="AND")

    if not match_query:
        logger.info("Lexical query is empty after normalization for %s", config.name)
        return []

    connection = connect_fts(config.db_path)
    ensure_schema(connection)
    def fetch_rows(current_match_query: str) -> List[sqlite3.Row]:
        return connection.execute(
        """
        SELECT
            doc,
            chunk_id,
            content,
            source_path,
            bm25(lexical_documents, 8.0, 4.0, 1.0) AS bm25_score
        FROM lexical_documents
        WHERE lexical_documents MATCH ?
        ORDER BY bm25_score ASC, doc ASC
        LIMIT ?
        """,
            (current_match_query, limit),
        ).fetchall()

    rows = fetch_rows(match_query)
    if not rows and len(tokenize_query(query)) > 1:
        match_query = build_match_query(query, operator="OR")
        rows = fetch_rows(match_query)
    connection.close()

    results: List[Dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        results.append(
            {
                "doc": row["doc"],
                "chunk_id": row["chunk_id"],
                "content": row["content"],
                "source_path": row["source_path"],
                "match_query": match_query,
                "bm25_score": row["bm25_score"],
                "lexical_rank": rank,
                "corpus": config.name,
                "index_document_count": ensure_summary["document_count"],
            }
        )
    return results


def rebuild_default_lexical_indexes(force: bool = False) -> List[Dict[str, Any]]:
    return [
        rebuild_lexical_index(config, force=force)
        for config in DEFAULT_LEXICAL_CORPORA.values()
    ]


def search_documents_lexical(query: str, n_results: int = 10) -> List[Dict[str, Any]]:
    return search_lexical_corpus(TECH_DOCS_LEXICAL_CONFIG, query, limit=n_results)


def search_non_conformities_lexical(query: str, n_results: int = 10) -> List[Dict[str, Any]]:
    return search_lexical_corpus(NC_LEXICAL_CONFIG, query, limit=n_results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or query lexical SQLite FTS5 indexes.")
    parser.add_argument(
        "--corpus",
        choices=["all", *DEFAULT_LEXICAL_CORPORA.keys()],
        default="all",
        help="Corpus to build/query.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force a rebuild even if the fingerprint did not change.",
    )
    parser.add_argument(
        "--query",
        default="",
        help="Optional lexical query to run after index creation.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Maximum number of query hits to print.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    corpus_names = (
        list(DEFAULT_LEXICAL_CORPORA.keys())
        if args.corpus == "all"
        else [args.corpus]
    )

    summaries = []
    for corpus_name in corpus_names:
        config = DEFAULT_LEXICAL_CORPORA[corpus_name]
        summary = rebuild_lexical_index(config, force=args.force)
        summaries.append(summary)
        print(summary)
        if args.query:
            hits = search_lexical_corpus(config, args.query, limit=args.limit)
            print({"corpus": corpus_name, "query": args.query, "hits": hits})


if __name__ == "__main__":
    main()
