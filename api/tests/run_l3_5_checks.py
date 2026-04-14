#!/usr/bin/env python3
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
API_ROOT = ROOT.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from src.retrieval_confidence import (
    LOW_CONFIDENCE_MESSAGE,
    assess_retrieval_confidence,
    build_low_confidence_payload,
)


def main() -> None:
    low_confidence = assess_retrieval_confidence(
        tech_docs_results=[{"doc": "weak-tech", "distance": 1.22}],
        non_conformity_results=[],
    )
    assert low_confidence["level"] == "low"

    high_confidence = assess_retrieval_confidence(
        tech_docs_results=[
            {
                "doc": "strong-tech",
                "retrieval_channels": ["lexical", "vector"],
                "vector_distance": 0.72,
                "rrf_score": 0.034,
            }
        ],
        non_conformity_results=[
            {
                "doc": "strong-nc",
                "retrieval_channels": ["lexical", "vector"],
                "vector_distance": 0.81,
                "rrf_score": 0.033,
            }
        ],
    )
    assert high_confidence["level"] == "high"

    cautious_payload = build_low_confidence_payload(
        role="000",
        user_message="Need help on unclear issue",
        description={"synthesis": "raw operator note"},
        sources={"tech_docs": {"sources": [{"doc": "weak-tech"}]}},
        confidence=low_confidence,
    )
    assert cautious_payload["text"] == LOW_CONFIDENCE_MESSAGE
    assert cautious_payload["description"] == {"synthesis": "raw operator note"}
    assert cautious_payload["sources"]["tech_docs"]["sources"][0]["doc"] == "weak-tech"

    print("l3.5 cautious retrieval checks: ok")


if __name__ == "__main__":
    main()
