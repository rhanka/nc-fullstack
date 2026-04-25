# L6.10 OCR Rebuild Report

Date: 2026-04-19

## Scope

Rebuild local RAG/wiki artefacts from the TypeScript OCR dataprep output. Mistral OCR extracts page Markdown and image crops. Caption LLMs may receive those OCR-extracted image crops with immediate Markdown context, but must not receive rendered full-page PDF images.

OpenAI/Gemini caption calls were disabled for this rebuild via the default `OCR_TECH_DOCS_CAPTIONS=off`, so no new caption API calls were made.

## Commands

```bash
make dataprep-ocr-tech-docs
make dataprep-prepare-tech-docs
make dataprep-tech-docs
make dataprep-knowledge-tech-docs
make api-smoke
make check
```

## Results

| Step | Result |
| --- | --- |
| OCR dataprep | 14,008 page PDFs considered; 14,008 OCR JSON read; 0 missing OCR pages |
| Caption/enrichment calls | 0 caption JSON written; 14,008 skipped by default `OCR_TECH_DOCS_CAPTIONS=off`; no image-caption API calls made during this rebuild |
| Prepared CSV | 14,612 rows written to `managed_dataset/a220_tech_docs_content_prepared.csv.gz` |
| Canonical CSV | 14,612 rows kept; 0 dropped; 0 malformed; 0 missing page rows; 0 duplicate chunk IDs |
| Character parity | `keptRowsCharExact=true`; source and canonical SHA both `d8861d5cc18c64a2ba10458e2341f33a8f5ec7721529aecddaddd09bd1c90eb1` |
| Vector export | 14,612 vectors; 3,072 dimensions |
| Lexical index | 14,612 FTS documents |
| Ontology | 49 ATA entries; 885 part entries; 32 zone entries |
| Wiki | 885 pages |
| Backend smoke | `make api-smoke` passed |
| Full check | `make check` passed: UI build, 63 backend tests, contracts |

## Artefacts

Generated local artefacts are under `api/data/a220-tech-docs/` and are ignored by git:

- `managed_dataset/a220_tech_docs_content_prepared.csv.gz`
- `managed_dataset/a220_tech_docs_content_prepared.audit.json`
- `managed_dataset/a220_tech_docs_content_canonical.csv.gz`
- `managed_dataset/a220_tech_docs_content_canonical.audit.json`
- `vector-export/manifest.json`
- `lexical/fts.sqlite3`
- `ontology/index.json`
- `wiki/index.json`
- `knowledge-manifest.json`

## UAT Status

Automated rebuild and smoke are done. Manual UAT is still pending, so `PLAN.md` keeps `L6.10` unchecked.

Manual UAT must cover:

- `000`: response quality, sources, entities, and document links.
- `100`: entity context contribution to deeper analysis, sources, and document links.
- `/doc` links: no 404 on technical sources returned by the assistant.

## Addendum 2026-04-25

The OCR/caption sidecar refresh path is now operationalized through:

```bash
make dataprep-ocr-caption-batch-create
make dataprep-ocr-caption-batch-status
make dataprep-ocr-caption-batch-import
make dataprep-ocr-caption-batch-refresh
```

A manual GitHub workflow `OCR Caption Batch` also exists for the same explicit operator flow, without coupling it to API deploys.

### Attempted Rebuild

Commands executed:

```bash
make dataprep-ocr-caption-batch-refresh
make dataprep-tech-docs
make dataprep-knowledge-tech-docs
```

Observed results:

| Step | Result |
| --- | --- |
| OCR refresh from imported captions | 14,008 pages considered; 5,952 caption sidecars read; 5,851 enriched OCR JSON/Markdown artifacts rewritten; 0 errors |
| Canonical CSV | 14,933 source rows -> 12,227 canonical rows; 2,706 equivalent-doc rows dropped; character parity preserved on kept rows |
| Retrieval full rebuild | Blocked during embeddings with `OpenAI embeddings request failed: 429 insufficient_quota` |
| Knowledge-only rebuild | Completed from the refreshed canonical CSV: 12,227 records; 45 ATA; 856 wiki pages |

### Current Status

- `L6.10e` is implemented and verified.
- The initial `429 insufficient_quota` blocker described above has been superseded by the successful rerun documented below.
- `L6.10` remains open only for the manual UAT portion after the now-successful full rebuild.

## Addendum 2026-04-25 (quota refilled, full rebuild green)

Commands executed:

```bash
make dataprep-tech-docs
make dataprep-knowledge-tech-docs
make api-smoke
cd backend-ts && node --experimental-strip-types --test test/knowledge-public-artifacts.test.ts test/dataprep-pipeline.test.ts test/tech-docs-canonical.test.ts
```

Observed results:

| Step | Result |
| --- | --- |
| Retrieval full rebuild | Completed: `12,227` records, `12,227` vectors, 3,072 dimensions |
| Knowledge-only rebuild | Completed: `12,227` records, `45` ATA, `856` wiki pages |
| Servability audit | `0` missing docs in `vector-export`; `0` missing docs in `wiki`; `0` long FCOM alias docs remaining |
| Public image/wiki artifacts | Validation OK: `4,867` public images, `3,523` image relations, `1,232` linked wiki images |
| Backend smoke | `make api-smoke` passed |
| Targeted regression tests | `knowledge-public-artifacts`, `dataprep-pipeline`, `tech-docs-canonical` all passed |

Updated status:

- The previous `429 insufficient_quota` blocker is resolved.
- `L6.10` now remains open only because the manual UAT portion (`000`, `100`, linked sources/images) is still pending.
