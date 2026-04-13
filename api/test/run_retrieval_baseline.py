#!/usr/bin/env python3
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TECH_DOCS_ROOT = ROOT.parent / "data" / "a220-tech-docs" / "ocr"
NC_ROOT = ROOT.parent / "data" / "a220-non-conformities" / "md"
CASES_PATH = ROOT / "eval_cases.json"
REPORT_PATH = ROOT / "eval_report.json"
TOP_KS = (5, 10)


TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def normalize_text(value: str) -> str:
    ascii_text = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    return ascii_text


def tokenize(value: str) -> list[str]:
    return TOKEN_RE.findall(normalize_text(value))


def read_corpus(root: Path) -> list[dict]:
    items = []
    for path in sorted(root.glob("*.md")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        normalized = normalize_text(text)
        counts = Counter(tokenize(text))
        items.append(
            {
                "name": path.name,
                "normalized_text": normalized,
                "token_counts": counts,
            }
        )
    return items


def score_item(item: dict, query_tokens: list[str]) -> int:
    score = 0
    file_name = normalize_text(item["name"])
    for token in query_tokens:
        token_count = item["token_counts"].get(token, 0)
        if token_count:
            score += token_count * 2
        if token in file_name:
            score += 5
    return score


def rank_items(items: list[dict], query: str, limit: int = 10) -> list[dict]:
    query_tokens = tokenize(query)
    ranked = []
    for item in items:
        score = score_item(item, query_tokens)
        if score <= 0:
            continue
        ranked.append({"name": item["name"], "score": score})
    ranked.sort(key=lambda row: (-row["score"], row["name"]))
    return ranked[:limit]


def matches_prefix(name: str, prefixes: list[str]) -> bool:
    normalized_name = normalize_text(name)
    return any(normalized_name.startswith(normalize_text(prefix)) for prefix in prefixes)


def hit_at_k(ranked: list[dict], prefixes: list[str], k: int) -> bool:
    return any(matches_prefix(item["name"], prefixes) for item in ranked[:k])


def evaluate_case(case: dict, tech_docs: list[dict], nc_docs: list[dict]) -> dict:
    tech_ranked = rank_items(tech_docs, case["query"], limit=max(TOP_KS))
    nc_ranked = rank_items(nc_docs, case["query"], limit=max(TOP_KS))
    metrics = {}
    for k in TOP_KS:
        metrics[f"tech_hit@{k}"] = hit_at_k(tech_ranked, case["expected_tech_doc_prefixes"], k)
        metrics[f"nc_hit@{k}"] = hit_at_k(nc_ranked, case["expected_nc_prefixes"], k)
    return {
        "case_id": case["case_id"],
        "label": case["label"],
        "query": case["query"],
        "review_note": case["review_note"],
        "metrics": metrics,
        "top_tech_docs": tech_ranked,
        "top_non_conformities": nc_ranked,
    }


def summarize(results: list[dict]) -> dict:
    summary = {}
    for key in [f"tech_hit@{k}" for k in TOP_KS] + [f"nc_hit@{k}" for k in TOP_KS]:
        hits = sum(1 for row in results if row["metrics"].get(key))
        summary[key] = {
            "hits": hits,
            "total": len(results),
            "ratio": round(hits / len(results), 3) if results else 0.0,
        }
    return summary


def main() -> None:
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))["cases"]
    tech_docs = read_corpus(TECH_DOCS_ROOT)
    nc_docs = read_corpus(NC_ROOT)
    results = [evaluate_case(case, tech_docs, nc_docs) for case in cases]
    report = {
        "generated_at": "2026-04-11",
        "tech_doc_corpus_size": len(tech_docs),
        "non_conformity_corpus_size": len(nc_docs),
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
