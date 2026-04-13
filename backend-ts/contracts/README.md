# Backend TS Contracts

This directory is the contract entrypoint for the future TypeScript backend.

Current scope:

- `ai/source-v1`: exact contract frozen from the current Python `/ai` route
- `ai/v2`: target contract for the TypeScript runtime

Repo-local validation:

- `python backend-ts/contracts/validate_contracts.py`

Validation guarantees:

- fixtures conform to the versioned schemas
- `source-v1` fixtures stay aligned with the legacy fixtures frozen under `api/test/fixtures`
