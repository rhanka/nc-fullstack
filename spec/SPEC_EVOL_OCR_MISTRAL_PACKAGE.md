# SPEC_EVOL_OCR_MISTRAL_PACKAGE

## Intent

Reduce custom OCR/dataprep code by using the published npm package `mistral-ocr` for PDF to Markdown extraction, while preserving the current RAG dataset contract.

This is an analysis/specification step only. No OCR pipeline replacement is implemented in this lot.

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

## Target Architecture

Add a TS dataprep stage dedicated to OCR ingestion, separate from API runtime.

Proposed stages:

1. Read source PDFs from `api/data/a220-tech-docs/full/`.
2. Split each full PDF into page PDFs in `pages/` if not already present.
3. Run `mistral-ocr.convertPdf` on either full PDFs or page PDFs.
4. Persist raw OCR responses or page-level normalized JSON under `ocr/`.
5. Generate `managed_dataset/a220_tech_docs_content_prepared.csv.gz` from `ocr/` + `pages/`.
6. Reuse the existing canonicalization and TS dataprep unchanged.
7. Preserve the current final contract consumed by RAG:
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
- `buildTechDocsPreparedCsvFromOcr()`: emits the current tab-delimited gzip contract.
- `inferTechDocMetadata(markdown, docRoot, pageIndex)`: fills `ATA`, `parts`, `doc_type` using the same deterministic heuristics as current dataprep where possible.
- `auditOcrPreparedDataset()`: counts source PDFs, pages, OCR JSONs, CSV rows, missing page PDFs and duplicate chunk IDs.

## Open Technical Questions

- Whether to OCR full PDFs once or page PDFs independently.
- Whether full-PDF OCR preserves page indexes reliably enough for current page-level `/doc` navigation.
- Whether image extraction should be retained in the RAG corpus or only stored for future document rendering.
- Whether current `__with_img_desc.json` files represent a required feature or historical artifact.
- Whether metadata `ATA / parts / doc_type` should continue to be heuristic-only or receive an optional LLM assist step.

## Recommendation

Implement this as a progressive dataprep replacement, not as an API runtime change.

Recommended next lot:

1. Add `mistral-ocr` dependency to `backend-ts`.
2. Add a new command `npm run dataprep:ocr-tech-docs`.
3. Generate a small fixture from one PDF or two page PDFs.
4. Prove that generated CSV rows match the current RAG contract.
5. Run existing `dataprep-prepare-tech-docs`, `dataprep-tech-docs`, `api-test`.
6. Only then replace the current upstream/manual prepared CSV generation.

## Acceptance Criteria

- No Python dependency is introduced in backend dataprep.
- Current RAG input contract remains stable.
- The existing canonical CSV step still works.
- Full rebuild still produces `vector-export`, `lexical`, `ontology`, `wiki`.
- A deterministic audit proves page PDFs and OCR rows are aligned.
- UAT can compare retrieval quality before and after on the same scenarios.
