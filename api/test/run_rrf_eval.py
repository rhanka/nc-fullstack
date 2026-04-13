#!/usr/bin/env python3
import json
import pathlib
import sys
import unicodedata
from typing import Dict, List

ROOT = pathlib.Path(__file__).resolve().parent
API_ROOT = ROOT.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from src.search import (
    search_documents,
    search_documents_vector,
    search_non_conformities,
    search_non_conformities_vector,
)
CASES_PATH = ROOT / "eval_cases.json"
REPORT_PATH = ROOT / "rrf_eval_report.json"
TOP_KS = (5, 10)


def normalize_name(value: str) -> str:
    return (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


def matches_prefix(name: str, prefixes: List[str]) -> bool:
    normalized_name = normalize_name(pathlib.Path(name).stem)
    return any(normalized_name.startswith(normalize_name(prefix)) for prefix in prefixes)


def hit_at_k(results: List[Dict], prefixes: List[str], k: int) -> bool:
    return any(matches_prefix(item.get("doc", ""), prefixes) for item in results[:k])


def evaluate_case(case: Dict) -> Dict:
    query = case["query"]
    vector_tech = search_documents_vector(query, result_limit=max(TOP_KS))
    vector_nc = search_non_conformities_vector(query, result_limit=max(TOP_KS))
    rrf_tech = search_documents(query, n_results=max(TOP_KS), use_query_rewrite=False)
    rrf_nc = search_non_conformities(query, n_results=max(TOP_KS), use_query_rewrite=False)
    rewritten_tech = search_documents(query, n_results=max(TOP_KS), use_query_rewrite=True)
    rewritten_nc = search_non_conformities(query, n_results=max(TOP_KS), use_query_rewrite=True)

    metrics = {}
    for label, tech_hits, nc_hits in (
        ("vector", vector_tech, vector_nc),
        ("rrf", rrf_tech, rrf_nc),
        ("rewritten", rewritten_tech, rewritten_nc),
    ):
        for k in TOP_KS:
            metrics[f"{label}_tech_hit@{k}"] = hit_at_k(
                tech_hits,
                case["expected_tech_doc_prefixes"],
                k,
            )
            metrics[f"{label}_nc_hit@{k}"] = hit_at_k(
                nc_hits,
                case["expected_nc_prefixes"],
                k,
            )

    return {
        "case_id": case["case_id"],
        "label": case["label"],
        "query": query,
        "metrics": metrics,
        "top_vector_tech_docs": vector_tech,
        "top_rrf_tech_docs": rrf_tech,
        "top_rewritten_tech_docs": rewritten_tech,
        "top_vector_non_conformities": vector_nc,
        "top_rrf_non_conformities": rrf_nc,
        "top_rewritten_non_conformities": rewritten_nc,
    }


def summarize(case_results: List[Dict]) -> Dict:
    summary = {}
    keys = [
        f"{label}_{corpus}_hit@{k}"
        for label in ("vector", "rrf", "rewritten")
        for corpus in ("tech", "nc")
        for k in TOP_KS
    ]
    for key in keys:
        hits = sum(1 for row in case_results if row["metrics"].get(key))
        summary[key] = {
            "hits": hits,
            "total": len(case_results),
            "ratio": round(hits / len(case_results), 3) if case_results else 0.0,
        }
    return summary


def main() -> None:
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))["cases"]
    results = [evaluate_case(case) for case in cases]
    report = {
        "generated_at": "2026-04-12",
        "cases": results,
        "summary": summarize(results),
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
