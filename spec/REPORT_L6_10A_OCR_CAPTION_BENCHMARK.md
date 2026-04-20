# L6.10a OCR Caption Model Benchmark

## Objective

Evaluate whether `gpt-5.4-nano` is good enough for image-caption enrichment of Mistral OCR-extracted image crops, compared with `gpt-5.4`.

The benchmark sends each model the same inputs:
- OCR-extracted image crops from Mistral OCR.
- OCR Markdown context from the same page.
- No rendered full-page PDF image.

## Runs

| Run | Purpose | Models | Result |
| --- | --- | --- | --- |
| `api/data/a220-tech-docs/benchmarks/ocr-caption-2026-04-19T21-46-28-679Z` | Paired baseline comparison | `gpt-5.4-nano`, `gpt-5.4` | 59/60 OK; one `gpt-5.4-nano` JSON truncation |
| `api/data/a220-tech-docs/benchmarks/ocr-caption-2026-04-19T22-16-40-568Z` | Post-fix nano validation, resumed after terminal interruption | `gpt-5.4-nano` | 30/30 OK |

The second run reused already-written per-model JSON files and resumed only missing samples.

## Automated Changes Driven By The Benchmark

The benchmark exposed two concrete dataprep risks:
- `max_output_tokens=2200` could truncate long structured captions and produce invalid JSON.
- Some model outputs used nested objects inside array fields, which previously normalized to `[object Object]`.

Fixes now covered by tests:
- OpenAI image-caption `max_output_tokens` defaults to `6000` and is configurable via `IMAGE_CAPTION_MAX_OUTPUT_TOKENS`.
- The prompt explicitly requires plain strings in array fields.
- The normalizer flattens accidental object arrays into readable strings instead of `[object Object]`.
- The benchmark runner records per-model errors, continues the batch, logs progress, and resumes from existing result files.

## Metrics

| Model/run | Calls | OK | Errors | p50 | p90 | max | Avg technical description | Avg identifiers | Avg elements | Avg flows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.4-nano` baseline | 30 | 29 | 1 | 8.8s | 14.2s | 156.2s | 1783 chars | 6.1 | 6.4 | 2.0 |
| `gpt-5.4-nano` post-fix | 30 | 30 | 0 | 9.5s | 89.2s | 283.7s | 1858 chars | 5.6 | 9.0 | 2.1 |
| `gpt-5.4` baseline | 30 | 30 | 0 | 18.6s | 24.6s | 292.1s | 1300 chars | 7.5 | 8.1 | 4.8 |

Latency note: both models had queue/tail outliers. Median latency favors `nano`, but tail latency is not reliable enough to be the sole decision criterion.

## Human Evaluation

`gpt-5.4-nano` is sufficient for broad RAG enrichment:
- It extracts visible labels, figure references, ATA-like context and component names well enough for retrieval.
- It produces detailed technical descriptions after the output-token fix.
- It correctly handled the previously failing oil-indicating architecture page after the fix.

`gpt-5.4` remains better for relationship depth:
- It more consistently captures system flow and signal routing.
- It is stronger on pages where the image is a functional architecture rather than a simple labeled component view.
- Example: fuel transfer and oil indicating diagrams had clearer operational relationships and EICAS/status context with `gpt-5.4`.

Weaknesses observed on `nano`:
- It sometimes downweights real technical diagrams too aggressively.
- It is weaker on multi-hop relationships and signal paths.
- It may describe many visual details while missing the most useful high-level operational relationship.

## Decision Update

The initial wording `low-signal captions` is rejected because it is not operational enough. A cascade cannot depend on an implicit quality judgment from the same model that produced the caption.

The revised target is not `nano judges if nano is good`. The revised target is:

1. `gpt-5.4-nano` produces the caption plus a structured `routing_profile_v1`.
2. `routing_profile_v1` classifies the visual content and exposes evidence useful for both RAG and LLM Wiki.
3. TypeScript routing rules decide whether the page requires a `gpt-5.4` deep pass.
4. A replay benchmark calibrates the routing rules before the full rebuild.

The image captions feed two downstream consumers:
- RAG retrieval text.
- LLM Wiki entity linking and relation extraction.

Therefore routing must consider whether the image contains entity or relationship value, not just whether its text is useful for search.

## Proposed Routing Profile

`gpt-5.4-nano` should emit a structured routing profile alongside the caption:

```json
{
  "visual_content_type": "system_architecture_diagram",
  "domain": "power_plant_oil",
  "rag_value": {
    "needs_visual_caption": true,
    "retrieval_keywords_visible": true
  },
  "wiki_value": {
    "has_named_entities": true,
    "has_entity_relationships": true,
    "has_part_zone_or_ata_candidates": true,
    "has_component_hierarchy": true
  },
  "routing_evidence": [
    "visible ARINC 429 label",
    "visible CAN BUS label",
    "oil sensors connected to EEC",
    "EICAS display output"
  ]
}
```

The route to `gpt-5.4` is then based on content type and evidence, not on vague caption quality.

## Candidate Routing Matrix

| Content type from `routing_profile_v1` | Default route | Rationale |
| --- | --- | --- |
| `cover_page`, `front_matter`, `index_page`, `blank_page`, `separation_page` | no deep pass | Non-content or metadata pages; exclude/downweight for retrieval and wiki. |
| `simple_labeled_component_view` | `nano` | Usually enough for RAG keywords and simple entity candidates. |
| `cockpit_panel_or_display` | `nano`, unless entity-rich | Panels can be captioned cheaply unless they expose multiple named controls/states linked by logic. |
| `technical_table` | `nano` | Markdown/OCR should carry most of the value; deep vision rarely adds enough. |
| `system_architecture_diagram` | `gpt-5.4` | Usually contains components, interfaces and relationships useful for LLM Wiki. |
| `flow_diagram` | `gpt-5.4` | Directional relations are the primary value. |
| `wiring_signal_bus_diagram` | `gpt-5.4` | Signal/bus labels and component interfaces need relationship extraction. |
| `fuel_oil_hydraulic_transfer_diagram` | `gpt-5.4` | Operational flows and system relations are high-value for troubleshooting. |
| `component_hierarchy_or_exploded_view` | `gpt-5.4` | Useful for part/subpart hierarchy in LLM Wiki. |

Technical retry remains separate:
- API error.
- Invalid JSON.
- Invalid schema.
- Required caption blocks missing despite OCR image crops.

## Required Replay Before Full Rebuild

Before applying this cascade to the full corpus, run a replay on the benchmark sample:

1. Generate `a220_image_caption_v2` with `gpt-5.4-nano`.
2. Apply deterministic TypeScript routing rules to `routing_profile_v1`.
3. Compare routing decisions against the human evaluation of whether `gpt-5.4` added useful RAG or Wiki value.
4. Report confusion cases: pages routed to `nano` where `5.4` clearly improved entity/relationship extraction, and pages routed to `5.4` where nano was enough.
5. Finalize the routing matrix before `L6.10` full rebuild.

The desired output is a ratio, for example:

```text
nano-only pages: 70%
5.4 deep-pass pages: 30%
false nano risk: documented by page/type
false 5.4 cost: documented by page/type
```

## Current Recommendation

Do not use `gpt-5.4` for every image caption by default. It is too expensive/slow for the whole corpus relative to the marginal gain on simple pages.

Do not use `gpt-5.4-nano` alone for the final enriched corpus until the routing replay is done. It is good enough for many pages, but the benchmark suggests `gpt-5.4` adds value on relationship-rich architecture/flow diagrams, which are also the most useful pages for LLM Wiki.

Recommended next step:
- Implement `a220_image_caption_v2` and `routing_profile_v1`.
- Run replay calibration on the benchmark sample.
- Only then run the full OCR caption rebuild.

## Verification

- `make api-test`: 70 tests passed after benchmark hardening.
- `OCR_CAPTION_BENCHMARK_LIMIT=30 OCR_CAPTION_BENCHMARK_MODELS=gpt-5.4-nano,gpt-5.4 make dataprep-ocr-caption-benchmark`: completed paired baseline run, with one nano JSON truncation captured.
- `OCR_CAPTION_BENCHMARK_OUTPUT_DIR=/home/antoinefa/src/nc-fullstack/api/data/a220-tech-docs/benchmarks/ocr-caption-2026-04-19T22-16-40-568Z OCR_CAPTION_BENCHMARK_LIMIT=30 OCR_CAPTION_BENCHMARK_MODELS=gpt-5.4-nano make dataprep-ocr-caption-benchmark`: resumed and completed post-fix nano validation, 30/30 OK.
