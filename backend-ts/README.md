# Backend TS

Incremental TypeScript backend foundation for the NC stack.

Current guarantees:

- no separate facade
- repo-local executable skeleton
- explicit module split: `contracts / retrieval / llm / services / routes`
- smoke endpoint available on `GET /ping`
- `/ai` default path is native TS
- vector retrieval runtime expects `api/data/*/vector-export/manifest.json`
- retrieval engine is selected by `NC_RETRIEVAL_ENGINE`
  - `export_exact` = current neutral-export fallback
  - `lancedb` = embedded LanceDB OSS backend

Useful commands:

- `npm --prefix backend-ts run contracts:check`
- `npm --prefix backend-ts run smoke`
- `npm --prefix backend-ts run start`
- `npm --prefix backend-ts run vectors:export`
- `npm --prefix backend-ts run lancedb:import`

Import behavior:

- `lancedb:import` builds the embedded LanceDB corpora repo-locally from `vector-export`
- by default it materializes the table plus the FTS index only
- set `LANCEDB_BUILD_VECTOR_INDEX=1` if you explicitly want the LanceDB ANN/vector index during import

Cutover commands:

- local default stack: `make up`
- local TS alias: `make up-ts`
- build TS API image: `make api-build`
- publish TS API image: `make api-image-publish`
- deploy TS API image to Scaleway container: `make deploy-api`
- rollback to the current Python image: `make rollback-api-python`
