from src import search as search_module
from src.query_rewrite import (
    QueryRewriteResult,
    clear_query_rewrite_cache,
    rewrite_retrieval_query,
)


def test_rewrite_retrieval_query_infers_fuel_grounding_context(monkeypatch) -> None:
    monkeypatch.setenv("RETRIEVAL_QUERY_REWRITE_USE_LLM", "false")
    clear_query_rewrite_cache()

    result = rewrite_retrieval_query(
        "electrostatic discharge reservoir tank right wing grounding electrical esd",
        corpus="non_conformities",
    )

    assert result.variants[0] == "electrostatic discharge reservoir tank right wing grounding electrical esd"
    assert any("ATA 28" in variant for variant in result.variants)
    assert any("grounding" in variant.lower() for variant in result.variants)
    assert any("fuel tank" in variant.lower() for variant in result.variants)
    assert result.llm_used is False


def test_search_documents_uses_rewrite_variants(monkeypatch) -> None:
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

    monkeypatch.setattr(search_module, "search_documents_vector", fake_vector)
    monkeypatch.setattr(search_module, "search_documents_lexical", fake_lexical)
    monkeypatch.setattr(
        search_module,
        "rewrite_retrieval_query",
        lambda query, *, corpus: QueryRewriteResult(
            original_query=query,
            normalized_query=query.lower(),
            corpus=corpus,
            variants=(query, "ATA 28 fuel tank grounding electrical bonding"),
            reasons=("fuel + grounding",),
            llm_used=False,
            llm_model=None,
            llm_error=None,
        ),
    )

    results = search_module.search_documents(
        "electrostatic discharge reservoir tank",
        n_results=5,
        use_query_rewrite=True,
    )

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


def test_search_documents_can_disable_query_rewrite(monkeypatch) -> None:
    vector_calls = []
    lexical_calls = []

    def fake_vector(query: str, n_results: int = 15, result_limit: int = 10):
        vector_calls.append(query)
        return [{"doc": "raw-hit.md", "content": "raw", "distance": 0.1}]

    def fake_lexical(query: str, n_results: int = 10):
        lexical_calls.append(query)
        return [{"doc": "raw-hit.md", "content": "raw", "bm25_score": -1.0}]

    monkeypatch.setattr(search_module, "search_documents_vector", fake_vector)
    monkeypatch.setattr(search_module, "search_documents_lexical", fake_lexical)

    results = search_module.search_documents(
        "fuel tank issue",
        n_results=5,
        use_query_rewrite=False,
    )

    assert vector_calls == ["fuel tank issue"]
    assert lexical_calls == ["fuel tank issue"]
    assert results[0]["doc"] == "raw-hit.md"
