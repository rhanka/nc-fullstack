import json
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Sequence

from src.lexical_search import normalize_text, tokenize_query


logger = logging.getLogger(__name__)

QUERY_REWRITE_MODEL = os.getenv("RETRIEVAL_QUERY_REWRITE_MODEL", "gpt-5.4-nano")
QUERY_REWRITE_MAX_VARIANTS = int(os.getenv("RETRIEVAL_QUERY_REWRITE_MAX_VARIANTS", "4"))


@dataclass(frozen=True)
class QueryRewriteResult:
    original_query: str
    normalized_query: str
    corpus: str
    variants: tuple[str, ...]
    reasons: tuple[str, ...]
    llm_used: bool
    llm_model: str | None
    llm_error: str | None


def _compact_whitespace(value: str) -> str:
    return " ".join(str(value).strip().split())


def _feature_flag(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "t")


def _variant_identity(value: str) -> str:
    return " ".join(tokenize_query(value))


def _add_unique_variant(
    variants: List[str],
    seen: set[str],
    candidate: str,
) -> None:
    normalized_candidate = _compact_whitespace(candidate)
    if not normalized_candidate:
        return
    identity = _variant_identity(normalized_candidate)
    if not identity or identity in seen:
        return
    seen.add(identity)
    variants.append(normalized_candidate)


def _contains_any(tokens: Sequence[str], candidates: Sequence[str]) -> bool:
    return any(candidate in tokens for candidate in candidates)


def _build_rule_based_variants(query: str, *, corpus: str) -> tuple[List[str], List[str]]:
    normalized_query = _compact_whitespace(query)
    normalized_tokens = tokenize_query(normalized_query)
    token_set = set(normalized_tokens)
    variants: List[str] = [normalized_query]
    reasons: List[str] = []
    seen = {_variant_identity(normalized_query)}

    fuel_tokens = (
        "fuel",
        "tank",
        "reservoir",
        "collector",
        "surge",
        "refuel",
        "defuel",
        "pump",
        "quantity",
        "gauge",
        "probe",
    )
    electrical_tokens = ("electrostatic", "static", "esd", "grounding", "bonding", "electrical")
    structural_tokens = (
        "windshield",
        "frame",
        "flushness",
        "rivets",
        "rivet",
        "pare",
        "brise",
        "structural",
        "repair",
    )
    damage_tokens = ("scratch", "damage", "rayure", "zone", "surface", "aluminum", "aluminium")
    door_tokens = ("door", "delamination", "composite")

    has_fuel_signal = _contains_any(normalized_tokens, fuel_tokens)
    has_electrical_signal = _contains_any(normalized_tokens, electrical_tokens)
    has_structural_signal = _contains_any(normalized_tokens, structural_tokens)
    has_damage_signal = _contains_any(normalized_tokens, damage_tokens)
    has_door_signal = _contains_any(normalized_tokens, door_tokens)

    wing_side_terms: List[str] = []
    if "left" in token_set or "gauche" in token_set:
        wing_side_terms.extend(["left wing", "left main tank"])
        reasons.append("left wing context detected")
    if "right" in token_set or "droite" in token_set or "droit" in token_set:
        wing_side_terms.extend(["right wing", "right main tank"])
        reasons.append("right wing context detected")

    if has_fuel_signal:
        reasons.append("fuel / tank context inferred")
        if corpus == "non_conformities":
            _add_unique_variant(
                variants,
                seen,
                "ATA 28 fuel system fuel tank fuel quantity fuel pump sensor wiring",
            )
        else:
            _add_unique_variant(
                variants,
                seen,
                "ATA 28 fuel system fuel tank collector tank surge tank",
            )

    if has_electrical_signal:
        reasons.append("electrical / grounding context inferred")
        _add_unique_variant(
            variants,
            seen,
            "electrical grounding bonding electrostatic discharge static discharge ESD",
        )

    if has_fuel_signal and has_electrical_signal:
        reasons.append("fuel plus electrical combination inferred")
        joined = "ATA 28 fuel tank electrical grounding bonding electrostatic discharge"
        if wing_side_terms:
            joined = f"{joined} {' '.join(wing_side_terms)}"
        if corpus == "non_conformities":
            joined = f"{joined} wiring fuel pump sensor"
        else:
            joined = f"{joined} collector tank surge tank"
        _add_unique_variant(variants, seen, joined)

    if has_structural_signal:
        reasons.append("windshield / structural repair context inferred")
        _add_unique_variant(
            variants,
            seen,
            "ATA 56 windshield frame rivet structural repair flushness",
        )

    if has_damage_signal:
        reasons.append("surface damage context inferred")
        _add_unique_variant(
            variants,
            seen,
            "surface damage structural repair airframe scratch zone",
        )

    if has_door_signal:
        reasons.append("door composite context inferred")
        _add_unique_variant(
            variants,
            seen,
            "ATA 52 door composite delamination frame structure",
        )

    if wing_side_terms and not (has_fuel_signal and has_electrical_signal):
        _add_unique_variant(variants, seen, " ".join(wing_side_terms))

    return variants[:QUERY_REWRITE_MAX_VARIANTS], reasons


def _call_llm_rewrite(query: str, *, corpus: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    system_prompt = (
        "You rewrite aircraft maintenance retrieval queries for hybrid lexical and vector search. "
        "Return strict JSON with keys variants, ata_hints, keywords, reasons. "
        "Keep output short, retrieval-oriented, and in English. "
        "Do not invent symptoms; only add strong aliases, ATA chapter hints, part synonyms, or zone synonyms that are clearly implied."
    )
    user_prompt = json.dumps(
        {
            "query": query,
            "corpus": corpus,
            "rules": {
                "max_variants": 2,
                "prefer_exact_terms": True,
                "allow_ata_inference_when_strong": True,
            },
            "examples": [
                {
                    "query": "electrostatic discharge reservoir tank right wing grounding electrical esd",
                    "output": {
                        "variants": [
                            "ATA 28 fuel tank right wing grounding electrical bonding electrostatic discharge",
                            "fuel system right main tank wiring grounding ESD",
                        ],
                        "ata_hints": ["ATA 28"],
                        "keywords": ["fuel tank", "right wing", "grounding", "bonding", "ESD"],
                        "reasons": ["fuel tank + electrical grounding strongly imply ATA 28 fuel system context"],
                    },
                }
            ],
        },
        ensure_ascii=False,
    )
    response = client.chat.completions.create(
        model=QUERY_REWRITE_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def _merge_llm_variants(
    variants: List[str],
    reasons: List[str],
    llm_payload: dict,
) -> List[str]:
    seen = {_variant_identity(item) for item in variants}

    for value in llm_payload.get("variants", []) or []:
        _add_unique_variant(variants, seen, str(value))

    keyword_values = [str(item) for item in (llm_payload.get("keywords", []) or []) if str(item).strip()]
    ata_values = [str(item) for item in (llm_payload.get("ata_hints", []) or []) if str(item).strip()]
    if ata_values or keyword_values:
        _add_unique_variant(variants, seen, " ".join(ata_values + keyword_values))

    for reason in llm_payload.get("reasons", []) or []:
        cleaned = _compact_whitespace(str(reason))
        if cleaned and cleaned not in reasons:
            reasons.append(cleaned)

    return variants[:QUERY_REWRITE_MAX_VARIANTS]


def _should_attempt_llm(query: str, reasons: Sequence[str]) -> bool:
    normalized_reasons = set(reasons)
    if (
        "fuel / tank context inferred" in normalized_reasons
        and "electrical / grounding context inferred" in normalized_reasons
    ):
        return True
    normalized_tokens = set(tokenize_query(query))
    return "ata" in normalized_tokens and "fuel" in normalized_tokens


@lru_cache(maxsize=256)
def rewrite_retrieval_query(query: str, *, corpus: str) -> QueryRewriteResult:
    normalized_query = normalize_text(query)
    variants, reasons = _build_rule_based_variants(query, corpus=corpus)
    llm_used = False
    llm_error = None
    llm_model = None

    if (
        _feature_flag("RETRIEVAL_QUERY_REWRITE_ENABLED")
        and _feature_flag("RETRIEVAL_QUERY_REWRITE_USE_LLM")
        and os.getenv("OPENAI_API_KEY")
        and _should_attempt_llm(query, reasons)
    ):
        try:
            llm_payload = _call_llm_rewrite(query, corpus=corpus)
            variants = _merge_llm_variants(variants, reasons, llm_payload)
            llm_used = True
            llm_model = QUERY_REWRITE_MODEL
        except Exception as exc:
            llm_error = str(exc)
            llm_model = QUERY_REWRITE_MODEL
            logger.warning("Query rewrite LLM failed for corpus=%s: %s", corpus, exc)

    return QueryRewriteResult(
        original_query=_compact_whitespace(query),
        normalized_query=normalized_query,
        corpus=corpus,
        variants=tuple(variants[:QUERY_REWRITE_MAX_VARIANTS]),
        reasons=tuple(dict.fromkeys(reason for reason in reasons if reason)),
        llm_used=llm_used,
        llm_model=llm_model,
        llm_error=llm_error,
    )


def clear_query_rewrite_cache() -> None:
    rewrite_retrieval_query.cache_clear()
