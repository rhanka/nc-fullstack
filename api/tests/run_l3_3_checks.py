#!/usr/bin/env python3
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
API_ROOT = ROOT.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def load_local_env() -> None:
    env_path = API_ROOT.parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)

    if os.getenv("OPENAI_API_KEY") and not os.getenv("CHROMA_OPENAI_API_KEY"):
        os.environ["CHROMA_OPENAI_API_KEY"] = os.environ["OPENAI_API_KEY"]


load_local_env()

from src import search as search_module
from src.query_rewrite import (
    QueryRewriteResult,
    clear_query_rewrite_cache,
    rewrite_retrieval_query,
)


def check_rule_based_rewrite() -> None:
    os.environ["RETRIEVAL_QUERY_REWRITE_USE_LLM"] = "false"
    clear_query_rewrite_cache()

    result = rewrite_retrieval_query(
        "electrostatic discharge reservoir tank right wing grounding electrical esd",
        corpus="non_conformities",
    )

    assert result.variants[0] == "electrostatic discharge reservoir tank right wing grounding electrical esd"
    assert any("ATA 28" in variant for variant in result.variants)
    assert any("grounding" in variant.lower() for variant in result.variants)
    assert any("fuel tank" in variant.lower() for variant in result.variants)


def check_search_variant_integration() -> None:
    original_vector = search_module.search_documents_vector
    original_lexical = search_module.search_documents_lexical
    original_rewrite = search_module.rewrite_retrieval_query

    vector_calls = []
    lexical_calls = []

    def fake_vector(query: str, n_results: int = 15, result_limit: int = 10):
        vector_calls.append(query)
        if "ATA 28" in query:
            return [{"doc": "ATA-28-hit.md", "content": "fuel tank grounding", "distance": 0.1}]
        return [{"doc": "ATA-50-hit.md", "content": "static discharge cable", "distance": 0.2}]

    def fake_lexical(query: str, n_results: int = 10):
        lexical_calls.append(query)
        if "ATA 28" in query:
            return [{"doc": "ATA-28-hit.md", "content": "fuel tank grounding", "bm25_score": -5.0}]
        return []

    try:
        search_module.search_documents_vector = fake_vector
        search_module.search_documents_lexical = fake_lexical
        search_module.rewrite_retrieval_query = lambda query, *, corpus: QueryRewriteResult(
            original_query=query,
            normalized_query=query.lower(),
            corpus=corpus,
            variants=(query, "ATA 28 fuel tank grounding electrical bonding"),
            reasons=("fuel + grounding",),
            llm_used=False,
            llm_model=None,
            llm_error=None,
        )

        results = search_module.search_documents(
            "electrostatic discharge reservoir tank",
            n_results=5,
            use_query_rewrite=True,
        )
    finally:
        search_module.search_documents_vector = original_vector
        search_module.search_documents_lexical = original_lexical
        search_module.rewrite_retrieval_query = original_rewrite

    assert vector_calls == [
        "electrostatic discharge reservoir tank",
        "ATA 28 fuel tank grounding electrical bonding",
    ]
    assert lexical_calls == [
        "electrostatic discharge reservoir tank",
        "ATA 28 fuel tank grounding electrical bonding",
    ]
    assert results[0]["doc"] == "ATA-28-hit.md"
    assert sorted(results[0]["retrieval_channels"]) == ["lexical", "vector"]


def main() -> None:
    check_rule_based_rewrite()
    check_search_variant_integration()
    print("l3.3 query rewrite checks: ok")


if __name__ == "__main__":
    main()
