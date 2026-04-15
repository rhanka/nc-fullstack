# Backend TS

Incremental TypeScript backend foundation for the NC stack.

Current guarantees:

- no separate facade
- repo-local executable skeleton
- explicit module split: `contracts / retrieval / llm / services / routes`
- smoke endpoint available on `GET /ping`
- `/ai` default path is native TS
- vector retrieval runtime expects `api/data/*/vector-export/manifest.json`
- retrieval runtime is fixed on `export_exact`
  - exact dense search over `vector-export`
  - lexical search over `SQLite FTS5`
  - hybrid fusion via `RRF`

Useful commands:

- `npm --prefix backend-ts run contracts:check`
- `npm --prefix backend-ts run smoke`
- `npm --prefix backend-ts run start`
- `npm --prefix backend-ts run vectors:export`

Cutover commands:

- local default stack: `make up`
- local TS alias: `make up-ts`
- build TS API image: `make api-build`
- publish TS API image: `make api-image-publish`
- deploy TS API image to Scaleway container: `make deploy-api`
- rollback to the current Python image: `make rollback-api-python`
