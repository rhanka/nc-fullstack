from typing import Any, Dict, List


LOW_CONFIDENCE_MESSAGE = (
    "Low-confidence retrieval. I kept the current input conservative and did not infer additional "
    "technical specifics. Provide ATA, zone, part number, measurements, or a validated similar case."
)


def source_signal(item: Dict[str, Any]) -> int:
    has_explicit_signal = any(
        key in item
        for key in ("retrieval_channels", "rrf_score", "vector_distance", "distance", "lexical_score")
    )
    if not has_explicit_signal:
        return 2

    score = 0
    channels = set(item.get("retrieval_channels") or [])
    if "lexical" in channels:
        score += 2
    if "vector" in channels:
        vector_distance = item.get("vector_distance", item.get("distance"))
        if isinstance(vector_distance, (float, int)) and vector_distance <= 1.0:
            score += 1
    rrf_score = item.get("rrf_score")
    if isinstance(rrf_score, (float, int)) and rrf_score >= 0.03:
        score += 1
    return score


def assess_retrieval_confidence(
    tech_docs_results: List[Dict[str, Any]],
    non_conformity_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    sampled_results = list(tech_docs_results[:3]) + list(non_conformity_results[:3])
    if not sampled_results:
        return {"level": "low", "signals": [], "reason": "no retrieval results"}

    signals = [source_signal(item) for item in sampled_results]
    best_signal = max(signals)
    medium_or_better = sum(1 for signal in signals if signal >= 2)

    if best_signal <= 1 and medium_or_better == 0:
        level = "low"
        reason = "results are sparse and weakly supported"
    elif best_signal >= 3 and medium_or_better >= 2:
        level = "high"
        reason = "multiple results are cross-supported"
    else:
        level = "medium"
        reason = "some support exists but remains partial"

    return {
        "level": level,
        "signals": signals,
        "reason": reason,
    }


def build_low_confidence_payload(
    *,
    role: str,
    user_message: str,
    description: Any,
    sources: Dict[str, Any],
    confidence: Dict[str, Any],
) -> Dict[str, Any]:
    label = description.get("label") if isinstance(description, dict) else None
    return {
        "text": LOW_CONFIDENCE_MESSAGE,
        "label": label,
        "description": description,
        "sources": sources,
        "user_query": user_message,
        "input_description": description,
        "role": "ai",
        "user_role": role,
    }
