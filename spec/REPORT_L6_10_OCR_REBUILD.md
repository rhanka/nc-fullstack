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
