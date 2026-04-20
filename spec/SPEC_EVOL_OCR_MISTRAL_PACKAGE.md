# SPEC_EVOL_OCR_MISTRAL_PACKAGE

## Intent

Reduce custom OCR/dataprep code by using the published npm package `mistral-ocr` for PDF to Markdown extraction, while preserving the current RAG dataset contract.

This spec has moved from analysis to implementation. The first implementation provides a TypeScript dataprep command that can rebuild the prepared CSV from existing OCR artefacts, can optionally run live `mistral-ocr` on page PDFs, and can optionally create caption-analysis JSON from OCR-extracted image crops plus immediate OCR Markdown context. LLM providers may receive images extracted by Mistral OCR, but must never receive a rendered image of the full PDF page.

## Current State

The production API does not run OCR at request time.

The current retrieval pipeline consumes already prepared data:

- Full source PDFs live under `api/data/a220-tech-docs/full/`.
- Servable page PDFs live under `api/data/a220-tech-docs/pages/`.
- OCR page JSON files live under `api/data/a220-tech-docs/ocr/`.
- Retrieval input is `api/data/a220-tech-docs/managed_dataset/a220_tech_docs_content_prepared.csv.gz`.
- The TS canonicalization step writes `a220_tech_docs_content_canonical.csv.gz`.
- TS dataprep builds `vector-export/`, `lexical/fts.sqlite3`, `ontology/`, `wiki/` from the canonical CSV.

The OCR JSON files already follow the Mistral OCR response shape closely:

- root fields: `model`, `pages`, `usage_info`
- page fields: `index`, `markdown`, `images`, `dimensions`
- image fields: `id`, coordinates, and sometimes `image_base64`

## Package Reviewed

Local repo: `../mistral-ocr`

Published npm package checked: `mistral-ocr@0.1.0`

Useful exported API:

- `convertPdf(input, options)`
- `buildMarkdownFromOcrResponse(ocrResponse, replacements?)`
- `extractImagesFromOcrResponse(ocrResponse)`
- `writeExtractedImages(images, imageOutputDir, referenceBaseDir?)`

Runtime expectations:

- Node `>=20`
- `MISTRAL_API_KEY` or explicit `apiKey`
- Uses `mistral-ocr-latest` by default
- Can return Markdown without generating DOCX via `generateDocx: false`

## Image Caption Requirement

Historical Dataiku output was not OCR-only. It used:

1. `mistral-ocr-latest` with `include_image_base64=true` to extract page Markdown and image payloads.
2. A separate vision chat call, historically `pixtral-12b-2409`, to describe each extracted image.
3. Enrichment files `__with_img_desc.json` and `__with_img_desc.md`, then RAG chunking over `md_img`.

The replacement pipeline reproduces this vision pass using the images extracted by Mistral OCR, not by rendering the full PDF page. LLM providers may receive OCR-extracted image crops as `data:image/*` / OpenAI `input_image` / Gemini `inline_data`, plus immediate OCR Markdown context, document metadata and image ids/placeholders. They must not receive a rendered image of the full PDF page.

This second pass is required for retrieval parity. It lets the caption model describe visual technical content in extracted figures while using nearby OCR Markdown as grounding context.

Target model configuration:

- Primary image-caption provider: OpenAI API.
- Current safe default image-caption model: `gpt-5.4`.
- Benchmark recommendation for the next calibration step: `gpt-5.4-nano` primary candidate with `gpt-5.4` deep pass for content types proven useful by replay.
- Image input detail: `original` for the extracted image crop.
- Caption reasoning: `none` by default; `low` only for complex diagrams if needed.
- Fallback image-caption provider: OpenAI API first; Gemini remains a provider option for a later cross-provider fallback.
- Fallback image-caption model: `gpt-5.4` for technical retry and for content types routed by `routing_profile_v1` after replay calibration, `gemini-3.1-pro-preview` only if explicitly selected.
- Runtime configuration keys: `IMAGE_CAPTION_PROVIDER`, `IMAGE_CAPTION_MODEL`, `IMAGE_CAPTION_DETAIL`, `IMAGE_CAPTION_REASONING`, `IMAGE_CAPTION_MAX_OUTPUT_TOKENS`, `IMAGE_CAPTION_FALLBACK_PROVIDER`, `IMAGE_CAPTION_FALLBACK_MODEL`.

The prompt receives OCR-extracted image crops, OCR Markdown/text around the image, document filename and page number. Cover pages, indexes and front matter are page-level concepts; if classification requires page-wide context, use OCR Markdown metadata, not a rendered full-page image.

### Image Caption Prompt

Use this prompt as the baseline for `a220_image_caption_v1`:

```text
You are an aerospace technical-document vision analyst for Airbus A220 technical documentation.

Analyze ONE A220 document image crop extracted by Mistral OCR, with its immediate OCR Markdown context. You may receive:
- one or more OCR-extracted image crops from the page,
- the OCR markdown/text extracted from the same page or around the image placeholder,
- document filename and page number metadata.

You will not receive a rendered image of the full PDF page. Ground visual descriptions in the provided extracted image crop and OCR context.

Return JSON only. Do not output markdown outside JSON.
All array fields must contain plain strings only, not nested objects.

Goals:
1. Classify the page for retrieval filtering.
2. If the page contains useful technical content, produce a precise RAG-oriented technical description.
3. If the page is cover/front matter/index/blank/separation/non-content, classify it explicitly so it can be excluded or downweighted.
4. Extract only visible evidence. Do not infer hidden aircraft systems, part numbers, ATA chapters, or procedures that are not visible in the image/text.

Allowed page_category values:
- technical_diagram
- technical_table
- technical_photo
- technical_procedure
- index_page
- cover_page
- front_matter
- blank_page
- separation_page
- other_non_technical
- unreadable

Classification rules:
- cover_page: title page, document cover, revision cover, supplier/manual cover, branded opening page.
- front_matter: revision history, approval page, legal notice, document control, preface, introduction without actionable technical content.
- index_page: table of contents, chapter breakdown, figure list, list of topics with page references.
- blank_page: empty page or "Page intentionally left blank".
- separation_page: section divider with title/header but no technical substance.
- technical_diagram: schematic, aircraft zone diagram, wiring/hydraulic/fuel/door/structure/system diagram, exploded view, annotated drawing.
- technical_table: data table, limits table, applicability matrix, inspection criteria table.
- technical_photo: real aircraft/component photo with technical labels or useful visual detail.
- technical_procedure: page containing task steps, inspection/repair/maintenance instructions, or operational process details.

For technical_diagram:
- Provide a deep description of the extracted image crop.
- Identify the visible system/component/zone, labels, arrows, flows, states, callouts, references, warnings, dimensions, units, figure numbers, ATA references, part numbers, and relationships.
- Preserve exact visible terms and identifiers from the image and OCR context.
- Describe spatial relationships using clear terms such as left/right/top/bottom/forward/aft/upstream/downstream only when visible in the extracted crop.
- If labels are partially unreadable, include them in uncertainties rather than guessing.

For non-content pages:
- Set is_non_content_page=true.
- Set retrieval_action to "exclude" or "downweight".
- Keep technical_description null.
- Provide only a short_summary explaining why the page is non-content.

Output JSON must match this schema exactly. Every array value is a string.
```

### Image Caption Output Schema

```json
{
  "schema_version": "a220_image_caption_v1",
  "page_category": "technical_diagram",
  "page_category_confidence": 0.0,
  "is_non_content_page": false,
  "retrieval_action": "index",
  "retrieval_weight": 1.0,
  "short_summary": "",
  "technical_description": "",
  "visible_text": [],
  "visible_identifiers": [],
  "ata_candidates": [],
  "part_or_zone_candidates": [],
  "diagram_elements": [],
  "relationships_or_flows": [],
  "warnings_or_limits": [],
  "figure_or_table_refs": [],
  "uncertainties": []
}
```

### Retrieval Policy

- `cover_page`, `blank_page`, `index_page`, `front_matter` and `separation_page` with confidence `>= 0.75`: exclude enriched content from vector/BM25 indexing, keep metadata and audit artefacts.
- Same categories with confidence `0.55-0.74`: downweight strongly, for example `retrieval_weight=0.15`.
- `technical_*` categories with confidence `>= 0.65`: index normally.
- Low-confidence `technical_*` categories: index conservatively with `retrieval_weight=0.4-0.6` and an audit tag.
- `unreadable`: do not create RAG caption text; log in audit and optionally retry with better resolution.

## Target Architecture

Add a TS dataprep stage dedicated to OCR ingestion, separate from API runtime.

Proposed stages:

1. Read source PDFs from `api/data/a220-tech-docs/full/`.
2. Split each full PDF into page PDFs in `pages/` if not already present.
3. Run `mistral-ocr.convertPdf` on either full PDFs or page PDFs.
4. Analyze each Mistral OCR-extracted image crop with the versioned `a220_image_caption_v1` prompt plus immediate OCR Markdown context; do not send rendered full-page PDF images.
5. Persist raw OCR responses, image-caption JSON, enriched page JSON and enriched Markdown under `ocr/`.
6. Generate `managed_dataset/a220_tech_docs_content_prepared.csv.gz` from `ocr/` + `pages/`, using `md_img` for indexable technical content and retrieval policy metadata for excluded/downweighted pages.
7. Reuse the existing canonicalization and TS dataprep unchanged.
8. Preserve the current final contract consumed by RAG:
   `doc, doc_root, json_data, chunk, length, chunk_id, ATA, parts, doc_type`.

## Integration Choice

Preferred first implementation: use `mistral-ocr` as a library from `backend-ts`, not as a shell CLI.

Reasoning:

- The package already exposes `convertPdf` and raw OCR response data.
- Library usage avoids parsing CLI output.
- Existing TS dataprep can share logging, manifests, retry policy and tests.
- The dependency remains Node-native and avoids reintroducing Python in backend dataprep.

CLI remains useful for manual one-off conversions and debugging.

## Compatibility Work Needed

The package returns Markdown and raw OCR response. The current RAG still needs page-level records and metadata.

Required adapter functions:

- `convertOcrResponseToPageJson(rootPdf, response)`: maps Mistral pages to the existing page JSON shape.
- `writePageOcrJson(pageDoc, json)`: writes deterministic files such as `MODULE 4 AIRFRAME_page_0875.json`.
- `analyzeExtractedImageForRag(imageDataUrls, ocrMarkdown, metadata)`: calls the configured image-caption model with OCR-extracted image crops plus `a220_image_caption_v1` context; rendered full-page images are forbidden.
- `applyPageRetrievalPolicy(imageAnalysis)`: returns `index`, `downweight` or `exclude` plus a numeric retrieval weight.
- `persistImageAnalysisJson(pageDoc, analysis)`: writes deterministic caption-analysis JSON beside OCR artefacts.
- `buildPageMarkdownWithImageDescriptions(pageJson, analysis)`: injects cleaned technical descriptions as Markdown alt text only for indexable technical pages.
- `buildTechDocsPreparedCsvFromOcr()`: emits the current tab-delimited gzip contract.
- `inferTechDocMetadata(markdown, docRoot, pageIndex)`: fills `ATA`, `parts`, `doc_type` using the same deterministic heuristics as current dataprep where possible.
- `auditOcrPreparedDataset()`: counts source PDFs, pages, OCR JSONs, image analyses, enriched Markdown files, CSV rows, excluded pages, downweighted pages, missing page PDFs and duplicate chunk IDs.

## Implemented V1

Implemented command:

- npm script: `npm run dataprep:ocr-tech-docs`
- make target: `make dataprep-ocr-tech-docs`
- default mode: `OCR_TECH_DOCS_MODE=existing`, which rebuilds the prepared CSV from existing `ocr/` artefacts without external API calls.
- live OCR mode: `OCR_TECH_DOCS_MODE=live`, which calls `mistral-ocr.convertPdf` on page PDFs and writes raw OCR JSON under `ocr/`.
- caption mode: `OCR_TECH_DOCS_CAPTIONS=off|missing|force`; `missing` or `force` writes `*.image-caption.json` using the configured image-caption provider.
- safe validation knobs: `OCR_TECH_DOCS_LIMIT`, `OCR_TECH_DOCS_OUTPUT_FILE`, `OCR_TECH_DOCS_AUDIT_FILE`, `OCR_TECH_DOCS_FORCE`.
- when caption JSON exists, enriched artefacts are written as `__with_img_desc.json` and `__with_img_desc.md` before CSV chunking.

Implemented adapter functions:

- `normalizeImageCaptionAnalysis`
- `applyPageRetrievalPolicy`
- `buildPageMarkdownWithImageDescriptions`
- `buildPreparedTechDocsCsvFromOcrArtifacts`
- `runOcrTechDocsDataprep`

Current V1 constraint: image captioning consumes Mistral OCR-extracted image crops and OCR Markdown context only. Rendered full-page PDF images are never sent to OpenAI or Gemini.

## L6.10a Benchmark Decision

See `spec/REPORT_L6_10A_OCR_CAPTION_BENCHMARK.md`.

Decision for the next OCR caption iteration:

- `gpt-5.4-nano` is good enough as the primary candidate for broad RAG enrichment.
- Image captions also feed LLM Wiki entity linking and relationship extraction, so routing must consider entity/relation value, not only retrieval text value.
- The phrase `low-signal caption` is rejected as too vague.
- The next schema version must add `routing_profile_v1`: a structured content type and evidence block emitted by `gpt-5.4-nano`.
- `gpt-5.4` should be used for content types calibrated by replay as relationship-rich or wiki-critical, not by a free-form quality judgment.
- The benchmark runner must remain resumable because OCR caption calls can be slow and terminal interruptions should not waste completed calls.
- `IMAGE_CAPTION_MAX_OUTPUT_TOKENS` defaults to `6000` to avoid truncated JSON on detailed technical diagrams.
- Caption post-processing must never leave `[object Object]` in retrieval text; accidental nested arrays/objects are flattened into readable strings.

Candidate `routing_profile_v1` fields:

- `visual_content_type`: one of `cover_page`, `front_matter`, `index_page`, `simple_labeled_component_view`, `cockpit_panel_or_display`, `technical_table`, `system_architecture_diagram`, `flow_diagram`, `wiring_signal_bus_diagram`, `fuel_oil_hydraulic_transfer_diagram`, `component_hierarchy_or_exploded_view`, `other`.
- `domain`: `fuel`, `power_plant_oil`, `flight_controls`, `hydraulics`, `avionics_electrical`, `airframe`, `doors`, `unknown`, etc.
- `rag_value`: whether the visual crop adds retrieval keywords beyond OCR Markdown.
- `wiki_value`: whether the visual crop contains named entities, entity relationships, part/zone/ATA candidates or component hierarchy.
- `routing_evidence`: short visible evidence strings supporting the profile.

Replay requirement before full rebuild:

1. Generate `a220_image_caption_v2` with `gpt-5.4-nano` on the benchmark sample.
2. Apply TypeScript routing rules to `routing_profile_v1`.
3. Compare route decisions against human evaluation of where `gpt-5.4` added useful RAG or Wiki value.
4. Finalize a routing matrix before applying cascade to the full corpus.

## L6.10b Calibration Spec

Status: specification only. This section does not validate the cascade. It defines the replay that must validate or reject it before implementation.

### Objective

Calibrate whether `gpt-5.4-nano` can classify OCR-extracted image content well enough to route only the high-value cases to `gpt-5.4`.

The routing objective has two consumers:

- RAG: improve retrievable technical text, labels, identifiers, procedures and troubleshooting clues.
- LLM Wiki: preserve entities and relationships for later linking into `ATA / part / zone / system_component` pages.

### `a220_image_caption_v2`

V2 is additive. It keeps V1 caption fields compatible with existing dataprep and adds a `routing_profile_v1` object.

```json
{
  "schema_version": "a220_image_caption_v2",
  "page_category": "technical_diagram",
  "page_category_confidence": 0.0,
  "is_non_content_page": false,
  "retrieval_action": "index",
  "retrieval_weight": 1.0,
  "short_summary": "",
  "technical_description": "",
  "visible_text": [],
  "visible_identifiers": [],
  "ata_candidates": [],
  "part_or_zone_candidates": [],
  "diagram_elements": [],
  "relationships_or_flows": [],
  "warnings_or_limits": [],
  "figure_or_table_refs": [],
  "uncertainties": [],
  "routing_profile_v1": {
    "visual_content_type": "system_architecture_diagram",
    "domain_candidates": ["power_plant_oil"],
    "rag_signal": {
      "ocr_markdown_sufficient": false,
      "visual_caption_adds_retrieval_terms": true,
      "retrieval_terms": ["oil pressure sensor", "EEC", "EICAS", "ARINC 429"]
    },
    "wiki_signal": {
      "has_named_entities": true,
      "has_entity_relationships": true,
      "has_part_zone_or_ata_candidates": true,
      "has_component_hierarchy": false,
      "entity_candidates": [
        {
          "label": "Electronic Engine Control",
          "type": "system_component",
          "evidence": "visible block label"
        }
      ],
      "relationship_candidates": [
        {
          "source": "Oil pressure sensor",
          "relation": "sends_signal_to",
          "target": "Electronic Engine Control",
          "evidence": "visible analog line"
        }
      ]
    },
    "routing_evidence": [
      "visible ARINC 429 label",
      "visible CAN BUS label",
      "sensor blocks connected to EEC"
    ]
  }
}
```

The model is not allowed to output a final route decision. It outputs content type and evidence. TypeScript owns routing.

### Controlled Vocabularies

`visual_content_type` must be one of:

- `cover_page`
- `front_matter`
- `index_page`
- `blank_page`
- `separation_page`
- `simple_labeled_component_view`
- `cockpit_panel_or_display`
- `technical_table`
- `technical_photo`
- `technical_procedure`
- `system_architecture_diagram`
- `flow_diagram`
- `wiring_signal_bus_diagram`
- `fuel_oil_hydraulic_transfer_diagram`
- `component_hierarchy_or_exploded_view`
- `other`
- `unclear`

`domain_candidates` may include:

- `fuel`
- `power_plant_oil`
- `flight_controls`
- `hydraulics`
- `avionics_electrical`
- `airframe`
- `doors`
- `landing_gear`
- `cabin`
- `oxygen`
- `fire_protection`
- `unknown`

Entity candidate `type` must be one of:

- `ata`
- `part`
- `zone`
- `system`
- `system_component`
- `sensor`
- `actuator`
- `valve`
- `panel`
- `display`
- `procedure`
- `figure`
- `other`

Relationship candidate `relation` must be one of:

- `contains`
- `part_of`
- `located_in`
- `connected_to`
- `interfaces_with`
- `feeds`
- `sends_signal_to`
- `receives_signal_from`
- `controls`
- `monitors`
- `actuates`
- `transfers_to`
- `routes_to`
- `indicates`
- `protects`
- `other`

### Candidate Routing Matrix

This matrix is a hypothesis to calibrate, not a final decision.

| Type | Candidate route | Why |
| --- | --- | --- |
| `cover_page`, `front_matter`, `index_page`, `blank_page`, `separation_page` | `nano` / exclude | No deep pass needed unless OCR classification itself fails. |
| `technical_table` | `nano` | Text is usually in Markdown; Wiki value is low unless entities are clearly named. |
| `technical_photo` | `nano` | Useful for keywords and visual context, usually weak for structured relations. |
| `cockpit_panel_or_display` | `nano` by default | Deep pass only if multiple controls/states/relations are extracted. |
| `simple_labeled_component_view` | `nano` by default | Good for entity candidates; deep pass only if hierarchy is dense. |
| `technical_procedure` | `nano` by default | Deep pass only if the image is the main source of step logic. |
| `system_architecture_diagram` | `gpt-5.4` candidate | High relationship value for Wiki and troubleshooting. |
| `flow_diagram` | `gpt-5.4` candidate | Flow direction and relation extraction are the main value. |
| `wiring_signal_bus_diagram` | `gpt-5.4` candidate | Bus/signal interfaces need relationship precision. |
| `fuel_oil_hydraulic_transfer_diagram` | `gpt-5.4` candidate | Transfer paths support both RAG and Wiki relations. |
| `component_hierarchy_or_exploded_view` | `gpt-5.4` candidate | Useful for `contains` / `part_of` graph edges. |

### Replay Protocol

The replay must use the same deterministic benchmark sample as `L6.10a` unless the sample file is unavailable; if unavailable, regenerate the sample with the same deterministic selector.

Steps:

1. Run `gpt-5.4-nano` with the V2 prompt on each sampled OCR page.
2. Persist raw V2 outputs and normalized profiles under an ignored benchmark output directory.
3. Apply the candidate TypeScript routing matrix without calling `gpt-5.4`.
4. Compare each route decision against the L6.10a paired benchmark and human review.
5. Label each page as:
   - `nano_sufficient`: no material RAG/Wiki gain from `gpt-5.4`.
   - `deep_useful_for_rag`: `gpt-5.4` materially improves retrieval text.
   - `deep_useful_for_wiki`: `gpt-5.4` materially improves entity/relation extraction.
   - `deep_required`: `nano` misses critical relationships or entities.
   - `ambiguous`: needs manual review or larger sample.
6. Produce a report at `spec/REPORT_L6_10B_OCR_ROUTING_CALIBRATION.md`.

### Metrics

The report must include:

- Total pages replayed.
- Pages routed `nano`.
- Pages routed `gpt-5.4`.
- False `nano`: routed `nano` but human label is `deep_useful_for_rag`, `deep_useful_for_wiki` or `deep_required`.
- False `gpt-5.4`: routed `gpt-5.4` but human label is `nano_sufficient`.
- Ambiguous pages.
- Estimated `gpt-5.4` call ratio for the full corpus.
- Examples of each confusion category.

### Acceptance Gate Before `L6.10d`

The cascade can move to implementation only if the replay produces an explicit decision:

- `accept_matrix`: false `nano` risk is acceptable and examples are understood.
- `revise_matrix`: rules need adjustment and replay should be repeated.
- `reject_cascade`: use a simpler model policy, for example `nano` only with technical retry, or `gpt-5.4` on a fixed explicit subset.

No full rebuild may use the cascade until this gate is closed.

### `L6.10d` Cascade Implementation

The accepted routing matrix is implemented as an opt-in dataprep caption policy, not as an API runtime behavior.

Activation:

- `IMAGE_CAPTION_POLICY=cascade` or `OCR_TECH_DOCS_CAPTION_POLICY=cascade`.
- Primary model: `IMAGE_CAPTION_PRIMARY_MODEL`, default `gpt-5.4-nano`.
- Deep-pass model: `IMAGE_CAPTION_DEEP_MODEL`, default `gpt-5.4`.

Runtime behavior per OCR page:

1. Run the primary `a220_image_caption_v2` profile with `gpt-5.4-nano`.
2. Apply deterministic TypeScript routing from `routing_profile_v1`.
3. Keep the primary caption when the route is `nano`.
4. Run the deep model only when the accepted route is `gpt-5.4`.
5. Treat primary JSON/schema/API failures as a technical retry, separate from routed deep passes.
6. If a routed deep pass fails, keep the primary caption and write the deep error in audit rather than losing the page.

Audit:

- For each generated `*.image-caption.json`, an optional sibling `*.image-caption.audit.json` records `primaryModel`, `deepModel`, `selectedModel`, route, trigger, reasons and errors.
- Triggers are `nano_route`, `routing_deep_pass`, `technical_retry`, and `deep_pass_failed_fallback_to_nano`.

The default single-model policy remains unchanged unless the cascade policy is explicitly enabled.

## Open Technical Questions

- Whether page-wide classification needs additional OCR-text heuristics beyond the extracted image crop plus Markdown context.
- Whether metadata `ATA / parts / doc_type` should continue to be heuristic-only or receive an optional LLM assist step.
- Whether downweighted pages should affect ranking directly in vector/BM25, or remain audit-only until a retrieval weighting field is added to the RAG contract.

## Recommendation

Implement this as a progressive dataprep replacement, not as an API runtime change.

Recommended next lot:

1. Add `mistral-ocr` dependency to `backend-ts`.
2. Add a new command `npm run dataprep:ocr-tech-docs`.
3. Add the versioned prompt and output schema for `a220_image_caption_v1`.
4. Generate fixtures covering at least: technical diagram, technical table, technical photo, cover page, index page and blank/separation page.
5. Prove that generated CSV rows match the current RAG contract and that non-content pages are excluded/downweighted.
6. Run existing `dataprep-prepare-tech-docs`, `dataprep-tech-docs`, `api-test`.
7. Only then replace the current upstream/manual prepared CSV generation.

## Acceptance Criteria

- No Python dependency is introduced in backend dataprep.
- Current RAG input contract remains stable.
- Image descriptions remain part of the RAG corpus through `md_img`.
- Non-content pages are explicitly classified and excluded or downweighted before retrieval indexing.
- The existing canonical CSV step still works.
- Full rebuild still produces `vector-export`, `lexical`, `ontology`, `wiki`.
- A deterministic audit proves page PDFs, OCR rows, image analyses, enriched Markdown and retrieval-policy decisions are aligned.
- UAT can compare retrieval quality before and after on the same scenarios.
- UAT confirms cover/index/front-matter pages no longer appear in top retrieval unless directly requested.
