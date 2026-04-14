FROM node:22-bookworm-slim AS dev

WORKDIR /app/backend-ts

COPY backend-ts/package.json /app/backend-ts/package.json
COPY backend-ts/package-lock.json /app/backend-ts/package-lock.json
RUN npm ci

ENV PORT=8000
ENV NC_RETRIEVAL_ENGINE=export_exact

EXPOSE 8000

CMD ["node", "--experimental-strip-types", "--watch", "src/server.ts"]

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY backend-ts/package.json /app/backend-ts/package.json
COPY backend-ts/package-lock.json /app/backend-ts/package-lock.json
RUN cd /app/backend-ts && npm ci

COPY backend-ts /app/backend-ts
COPY shared /app/shared
COPY api/src /app/api/src
COPY api/data/a220-non-conformities/json /app/api/data/a220-non-conformities/json
COPY api/data/a220-non-conformities/lexical /app/api/data/a220-non-conformities/lexical
COPY api/data/a220-non-conformities/vector-export /app/api/data/a220-non-conformities/vector-export
COPY api/data/a220-non-conformities/lancedb /app/api/data/a220-non-conformities/lancedb
COPY api/data/a220-tech-docs/lexical /app/api/data/a220-tech-docs/lexical
COPY api/data/a220-tech-docs/pages /app/api/data/a220-tech-docs/pages
COPY api/data/a220-tech-docs/vector-export /app/api/data/a220-tech-docs/vector-export
COPY api/data/a220-tech-docs/lancedb /app/api/data/a220-tech-docs/lancedb

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/backend-ts /app/backend-ts
COPY --from=build /app/shared /app/shared
COPY --from=build /app/api/src /app/api/src
COPY --from=build /app/api/data/a220-non-conformities/json /app/api/data/a220-non-conformities/json
COPY --from=build /app/api/data/a220-non-conformities/lexical /app/api/data/a220-non-conformities/lexical
COPY --from=build /app/api/data/a220-non-conformities/vector-export /app/api/data/a220-non-conformities/vector-export
COPY --from=build /app/api/data/a220-non-conformities/lancedb /app/api/data/a220-non-conformities/lancedb
COPY --from=build /app/api/data/a220-tech-docs/lexical /app/api/data/a220-tech-docs/lexical
COPY --from=build /app/api/data/a220-tech-docs/pages /app/api/data/a220-tech-docs/pages
COPY --from=build /app/api/data/a220-tech-docs/vector-export /app/api/data/a220-tech-docs/vector-export
COPY --from=build /app/api/data/a220-tech-docs/lancedb /app/api/data/a220-tech-docs/lancedb

WORKDIR /app/backend-ts

ENV PORT=8000
ENV NC_RETRIEVAL_ENGINE=export_exact

EXPOSE 8000

CMD ["node", "--experimental-strip-types", "src/server.ts"]
