# SPEC EVOL - CD Runtime Data

## Scope

This note formalizes the **short-term** runtime-data decision for `Lot 7`.
The active target is to reduce API CD time **without** changing hosting yet.

The chosen path is therefore:

- keep the current Scaleway `Serverless Containers` hosting
- replace flat-file multi-object hydration with a versioned runtime bundle
- use `tar.zst + manifest/hash` in the existing CI/CD path

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

- Serverless Containers are described as **stateless web applications**
- Serverless Containers only provide **ephemeral storage**
- that storage disappears after execution
- Object Storage performance guidance favors fewer/larger transfers over many small objects

Implication:

- there is no documented persistent mounted volume model for the current `Serverless Containers` runtime
- but this does **not** block the current lot, because the short-term target is bundle-based CI hydration, not mounted runtime persistence

## Decision

### Selected short-term architecture

1. Stay on `Serverless Containers`.
- Accept.
- Reason: no infra migration is needed to capture the quick wins requested in `Lot 7`.

2. Keep runtime corpus embedded in the built API image for now.
- Accept.
- Reason: on the current hosting, this remains the simplest deploy/runtime contract.

3. Replace multi-object runtime hydration in CI with a single versioned bundle.
- Accept.
- Reason:
  - aligns with the requested `1 / 2 / 4` sequence
  - removes the worst small-file transfer pattern
  - keeps the deploy path compatible with the existing hosting model

4. Use `tar.zst` as the default runtime bundle format, with manifest/hash sidecars.
- Accept.
- Reason:
  - good compression/decompression tradeoff
  - deterministic integrity check
  - explicit change detection for later skip logic

## Resulting Execution Order

The practical order for `Lot 7` is now:

1. `L7.1` sequence `API -> UI`
2. `L7.2` baseline the current CD
3. `L7.2a` remove duplicate retrieval download
4. `L7.4` package runtime data as one versioned bundle
5. `L7.5` lock the short-term architecture decision
6. `L7.3` switch the API CD from flat-file sync to bundle download/extract
7. `L7.7` skip bundle refresh when the manifest/hash is unchanged
8. `L7.8` add rollback + smoke gate before UI publication

## Target CD Principle

On the current hosting target:

1. build the runtime bundle from prepared corpus artifacts
2. publish the bundle and sidecars to Object Storage
3. in API CI, download the single bundle instead of syncing thousands of files
4. verify checksum
5. extract before Docker build
6. build/publish the API image with the extracted runtime data
7. deploy API
8. deploy UI only after API succeeds

## Non-Goals For This Lot

- no API hosting migration
- no runtime cold-start extraction inside the live serverless container

## Sources

- Scaleway Serverless Containers overview: https://www.scaleway.com/en/docs/serverless-containers/
- Scaleway Serverless Containers concepts: https://www.scaleway.com/en/docs/serverless-containers/concepts/
- Scaleway Serverless Containers limitations: https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/
- Scaleway Object Storage performance guidance: https://www.scaleway.com/en/docs/object-storage/reference-content/optimize-object-storage-performance/
