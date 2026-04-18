# Backend Contracts

This directory is the contract entrypoint for the backend.

Current scope:

- `ai/source-v1`: exact contract frozen from the original `/ai` route
- `ai/v2`: target contract for the current runtime

Repo-local validation:

- `make api-contracts`

Validation guarantees:

- fixtures conform to the versioned schemas
- `source-v1` fixtures stay aligned with the legacy fixtures frozen under `api/test/fixtures`
