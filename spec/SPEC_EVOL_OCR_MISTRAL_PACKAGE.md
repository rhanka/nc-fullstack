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
- Primary image-caption model: `gpt-5.4`.
- Image input detail: `original` for the extracted image crop.
- Caption reasoning: `none` by default; `low` only for complex diagrams if needed.
- Fallback image-caption provider: Google Gemini API.
- Fallback image-caption model: `gemini-3.1-pro-preview`.
- Runtime configuration keys: `IMAGE_CAPTION_PROVIDER`, `IMAGE_CAPTION_MODEL`, `IMAGE_CAPTION_DETAIL`, `IMAGE_CAPTION_REASONING`, `IMAGE_CAPTION_FALLBACK_PROVIDER`, `IMAGE_CAPTION_FALLBACK_MODEL`.

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

Output JSON must match this schema exactly.
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
