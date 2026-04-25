# SPEC EVOL - CD Runtime Data

## Scope

This note formalizes the runtime-data hosting decision for `Lot 7`.
It is attached to the active AI architecture refresh initiative and narrows one specific question:

- how to decouple API code from runtime data without regressing deploy time or cold-start behavior

## Current State

As of 2026-04-25:

- the API is deployed with `scw container container update`
- the runtime therefore targets **Scaleway Serverless Containers**
- the current API CD baseline is documented in [REPORT_L7_2_CD_BASELINE_2026-04-25.md](./REPORT_L7_2_CD_BASELINE_2026-04-25.md)
- `L7.4` now produces a versioned runtime bundle:
  - archive: `tar.zst`
  - sidecars: `.sha256`, `.manifest.json`, `.filelist`

Measured local bundle output on the current corpus:

- source payload: `3,530,775,077` bytes across `29,571` files
- bundle output: `2,318,759,043` bytes

## Platform Facts Checked

Official Scaleway docs checked on 2026-04-25:

- Serverless Containers are described as **stateless web applications**.
- Serverless Containers only provide **ephemeral storage** for the duration of the execution.
- That storage **disappears once the execution is complete**.
- Serverless Containers publish a **recommended maximum uncompressed image size of 1 GB** and a **temporary disk size max of 24,000 MiB**.
- Block Storage volumes are attached to **Instances**.
- File Storage is **Public Beta** and is attached to **Instances**; the quickstart explicitly requires a **POP2 Instance**.

Implication:

- there is no documented persistent mounted volume model for the current `Serverless Containers` runtime
- `Object Storage` is useful for bundles, but it is **not** a mounted persistent volume

## Decision

### Rejected as target architecture

1. Keep runtime data inside the API image.
- Reject.
- Reason: deploy time stays dominated by data hydration and image build; image size pressure remains high.

2. Stay on Serverless Containers and hydrate the bundle on every cold start into ephemeral storage.
- Reject as target architecture.
- Reason: technically possible, but it reintroduces repeated download/extract cost per instance lifecycle and does not create durable runtime state.

3. Use File Storage as the default persistent-volume answer.
- Reject as default.
- Reason: current docs position it on Instances, in Public Beta, and restricted to POP2 Instances in the quickstart.

### Selected target architecture

4. Migrate the API to a Scaleway compute target that supports mounted persistent storage, with **Instance + Block Storage** as the default recommendation.
- Accept.
- Reason:
  - directly aligned with the user need for a true persistent volume
  - officially documented attach/mount workflow
  - simplest durable model for a single API service
  - compatible with bundle hydration only when the manifest/hash changes

## Resulting Execution Order

The practical order for `Lot 7` becomes:

1. `L7.1` sequence `API -> UI`
2. `L7.2` baseline the current CD
3. `L7.2a` remove duplicate retrieval download
4. `L7.4` package runtime data as one versioned bundle
5. `L7.5` lock the hosting decision
6. `L7.6` migrate the API to a Scaleway target with persistent mounted storage
7. `L7.3` remove runtime data from the API image once the mounted storage exists
8. `L7.7` refresh runtime data only when the manifest/hash changes
9. `L7.8` add rollback + smoke gate before UI publication

`L7.3` is intentionally gated by `L7.5/L7.6`.
Doing `L7.3` first on Serverless Containers would only move the hydration penalty from CI build time to container start time.

## Target Runtime Layout

On the future mounted volume:

- `/srv/nc-data/a220-tech-docs/...`
- `/srv/nc-data/a220-non-conformities/...`
- `/srv/nc-data/runtime-bundles/api-runtime-data.tar.zst`
- `/srv/nc-data/runtime-bundles/api-runtime-data.manifest.json`

The API image becomes code-only and reads corpus paths from the mounted volume.

## CD Principle After Migration

1. Build and publish the API image independently of runtime data.
2. Compare desired runtime manifest/hash with the manifest present on the mounted volume.
3. If unchanged:
- skip data refresh
- deploy/restart the API only
4. If changed:
- download the bundle from Object Storage
- verify checksum
- extract on the mounted volume
- switch manifest atomically
- run API smoke
- only then allow UI deploy

## Risks

- `Instance + Block Storage` adds infra management that Serverless previously hid.
- `File Storage` may become attractive later for shared multi-instance access, but it is not the default path now.
- A future Scaleway feature change could alter the recommendation; the note should be revisited if Serverless Containers add mounted persistent storage.

## Sources

- Scaleway Serverless Containers overview: https://www.scaleway.com/en/docs/serverless-containers/
- Scaleway Serverless Containers concepts: https://www.scaleway.com/en/docs/serverless-containers/concepts/
- Scaleway Serverless Containers limitations: https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/
- Scaleway Block Storage quickstart: https://www.scaleway.com/en/docs/block-storage/quickstart/
- Scaleway File Storage quickstart: https://www.scaleway.com/en/docs/file-storage/quickstart/
