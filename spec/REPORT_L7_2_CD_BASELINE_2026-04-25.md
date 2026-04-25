# REPORT L7.2 - CD API Baseline (2026-04-25)

## Scope

Baseline du CD API actuel avant optimisation du lot 7:

- workflow GitHub Actions: `Deploy API to Scaleway`
- run observé: `24936551017`
- head SHA: `0f64dcfc6101abf6e2dfea2322b5253089e80a8f`
- objectif: isoler le coût `image check / data download / image build / publish / deploy`

## Measured Workflow Timings

### Workflow duration

- Durée totale observée du run: `37m26`

### Job: `Build and Deploy API`

- `Check if API image is up to date`: `2m22`
- `Capture API version`: `0m06`
- `Download data and Build API`: `32m15`
- `Publish API docker image`: `1m16`
- Job total: `36m07`

### Job: `Deploy API`

- `Use CLI`: `0m02`
- `Deploy API`: `1m06`
- Job total: `1m13`

## Data Payload Measured Locally

### Retrieval inputs downloaded by `dataprep-download-retrieval-inputs`

- Total bytes: `2,397,981,824` (`2.398 GB`, `2.233 GiB`)
- Total files: `10,625`

Breakdown:

- `a220-tech-docs/managed_dataset`: `7.75 MB`, `5` files
- `a220-tech-docs/vector-export`: `171.10 MB`, `4` files
- `a220-tech-docs/lexical`: `30.97 MB`, `1` file
- `a220-tech-docs/ontology`: `569.02 MB`, `4,875` files
- `a220-tech-docs/wiki`: `562.93 MB`, `5,724` files
- `a220-non-conformities/managed_dataset`: `32.39 MB`, `4` files
- `a220-non-conformities/vector-export`: `846.54 MB`, `4` files
- `a220-non-conformities/lexical`: `152.68 MB`, `1` file
- `a220-non-conformities/ontology`: `24.59 MB`, `6` files
- `a220-non-conformities/wiki`: `3 B`, `1` file

### Runtime assets downloaded by `dataprep-download-runtime-assets`

- Total bytes: `1,132,791,743` (`1.133 GB`, `1.055 GiB`)
- Total files: `18,944`

Breakdown:

- `a220-tech-docs/pages`: `1.055 GB`, `14,008` files
- `a220-non-conformities/json`: `77.98 MB`, `4,936` files

### Full data traffic on current CD path

Current `make api-build` path downloads:

1. retrieval inputs once in `api-image-check`
2. retrieval inputs again in `api-build`
3. runtime assets in `api-build`

So the current workflow touches:

- Total bytes: `5,928,755,391` (`5.929 GB`, `5.522 GiB`)
- Total files touched: `40,194`

## Bundle Baseline

Measured on the current local corpus:

- One-shot archive `tar.zst -3` over `retrieval + runtime assets`: `2,422,448,026` bytes (`2.422 GB`, `2.256 GiB`)

This is materially smaller than the raw one-pass download (`3.531 GB`) and, more importantly, collapses `29,569` objects into a single transfer unit.

## Transfer Lower Bounds

Scaleway does not publish a guaranteed official bandwidth figure for this exact path (`GitHub Actions -> Scaleway Object Storage -> CI runner`, nor for Serverless Containers runtime network). The table below is therefore a lower-bound estimate based on pure transfer only.

### One-pass download (`3.531 GB`)

- `100 Mb/s`: `4.71 min`
- `200 Mb/s`: `2.35 min`
- `500 Mb/s`: `0.94 min`

### Current full CD download volume (`5.929 GB`)

- `100 Mb/s`: `7.91 min`
- `200 Mb/s`: `3.95 min`
- `500 Mb/s`: `1.58 min`

### One-shot `tar.zst` bundle (`2.422 GB`)

- `100 Mb/s`: `3.23 min`
- `200 Mb/s`: `1.61 min`
- `500 Mb/s`: `0.65 min`

## Interpretation

The `37m26` run cannot be explained by link bandwidth alone.

The dominant cost is a combination of:

- duplicate retrieval download
- tens of thousands of small objects (`40,194` touched on the current path)
- object-by-object sync overhead
- Docker build on top of hydrated data
- image publish after a large build context has been prepared

Observed step durations support this:

- `image check` already costs `2m22` before any build
- the `Download data and Build API` step alone costs `32m15`
- publish and final deploy are comparatively small (`1m16` + `1m06`)

## Immediate Optimization Priority

Order of execution updated after `L7.4` validation:

1. `L7.1` sequence `API -> UI`
2. `L7.2` establish this baseline
3. `L7.2a` remove duplicate retrieval download from the API CD path
4. `L7.4` replace multi-object hydration with a versioned `tar.zst` bundle + manifest/hash
5. `L7.5` lock the short-term decision: keep `Serverless Containers`, optimize around the bundle path
6. `L7.3` switch API CD from flat-file sync to bundle download/extract
7. `L7.7+` add manifest-driven refresh and rollback/smoke gating
8. `L7.6` only if bundle-based CI hydration still leaves the CD too slow

## Source Notes

- Current workflow logic: `.github/workflows/deploy-api.yml`
- Current data download logic: `Makefile`, targets `dataprep-download-retrieval-inputs` and `dataprep-download-runtime-assets`
- Scaleway docs checked separately confirm:
  - current runtime uses Serverless Containers
  - no documented persistent mounted volume for this product
  - Object Storage performance guidance favors fewer/larger transfers over many small objects
