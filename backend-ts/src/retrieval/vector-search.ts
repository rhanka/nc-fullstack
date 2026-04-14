import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const SCAN_BUFFER_BYTES = 8 * 1024 * 1024;

export type VectorCorpusName = "tech_docs" | "non_conformities";

export interface VectorExportManifest {
  readonly version: "vector-export-v1";
  readonly corpus: VectorCorpusName;
  readonly embeddingModel: string;
  readonly metric: "l2";
  readonly dimensions: number;
  readonly count: number;
  readonly vectorsPath: string;
  readonly squaredNormsPath: string;
  readonly itemsPath: string;
}

export interface VectorCorpusConfig {
  readonly corpus: VectorCorpusName;
  readonly manifestPath: string;
}

export interface VectorSearchItem extends Record<string, unknown> {
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
}

export interface VectorSearchResult extends VectorSearchItem {
  readonly corpus: VectorCorpusName;
  readonly distance: number;
  readonly vector_rank: number;
}

export const TECH_DOCS_VECTOR_CONFIG: VectorCorpusConfig = {
  corpus: "tech_docs",
  manifestPath: path.join(
    API_ROOT,
    "data",
    process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs",
    "vector-export",
    "manifest.json",
  ),
};

export const NC_VECTOR_CONFIG: VectorCorpusConfig = {
  corpus: "non_conformities",
  manifestPath: path.join(
    API_ROOT,
    "data",
    process.env.NC_DIR?.trim() || "a220-non-conformities",
    "vector-export",
    "manifest.json",
  ),
};

type TopEntry = {
  readonly rowIndex: number;
  readonly distance: number;
};

function assertFinitePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function resolveExportPath(manifestPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(path.dirname(manifestPath), relativePath);
}

function normalizeItem(input: unknown): VectorSearchItem {
  if (!input || typeof input !== "object") {
    throw new Error("vector export item must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    ...record,
    doc: String(record.doc ?? record.embedding_id ?? ""),
    chunk_id: String(record.chunk_id ?? record.embedding_id ?? ""),
    content: String(record.content ?? ""),
  };
}

function loadManifest(manifestPath: string): VectorExportManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`vector export manifest not found: ${manifestPath}`);
  }

  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const version = raw.version;
  const metric = raw.metric;
  const corpus = raw.corpus;
  const dimensions = Number(raw.dimensions);
  const count = Number(raw.count);

  if (version !== "vector-export-v1") {
    throw new Error(`unsupported vector export version: ${String(version)}`);
  }
  if (metric !== "l2") {
    throw new Error(`unsupported vector metric: ${String(metric)}`);
  }
  if (corpus !== "tech_docs" && corpus !== "non_conformities") {
    throw new Error(`unsupported vector corpus: ${String(corpus)}`);
  }
  assertFinitePositiveInteger("manifest.dimensions", dimensions);
  assertFinitePositiveInteger("manifest.count", count);

  const vectorsPath = resolveExportPath(manifestPath, String(raw.vectorsPath ?? ""));
  const squaredNormsPath = resolveExportPath(manifestPath, String(raw.squaredNormsPath ?? ""));
  const itemsPath = resolveExportPath(manifestPath, String(raw.itemsPath ?? ""));

  return {
    version,
    corpus,
    embeddingModel: String(raw.embeddingModel ?? ""),
    metric,
    dimensions,
    count,
    vectorsPath,
    squaredNormsPath,
    itemsPath,
  };
}

function loadItems(itemsPath: string): readonly VectorSearchItem[] {
  if (!existsSync(itemsPath)) {
    throw new Error(`vector export items file not found: ${itemsPath}`);
  }

  return readFileSync(itemsPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => normalizeItem(JSON.parse(line) as unknown));
}

function loadSquaredNorms(filePath: string, expectedCount: number): Float32Array {
  if (!existsSync(filePath)) {
    throw new Error(`vector export squared norms file not found: ${filePath}`);
  }

  const buffer = readFileSync(filePath);
  if (buffer.byteLength !== expectedCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(
      `vector export squared norms size mismatch: expected ${expectedCount * Float32Array.BYTES_PER_ELEMENT} bytes, got ${buffer.byteLength}`,
    );
  }

  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

function normalizeQueryVector(
  queryVector: readonly number[] | Float32Array,
  expectedDimensions: number,
): Float32Array {
  const vector =
    queryVector instanceof Float32Array ? queryVector : Float32Array.from(queryVector);
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `query vector dimensions mismatch: expected ${expectedDimensions}, got ${vector.length}`,
    );
  }
  return vector;
}

function computeSquaredNorm(vector: Float32Array): number {
  let squaredNorm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index]!;
    squaredNorm += value * value;
  }
  return squaredNorm;
}

function upsertTopK(entries: TopEntry[], candidate: TopEntry, limit: number): void {
  if (entries.length < limit) {
    entries.push(candidate);
    entries.sort((left, right) => right.distance - left.distance);
    return;
  }

  const currentWorst = entries[0]!;
  if (candidate.distance >= currentWorst.distance) {
    return;
  }

  entries[0] = candidate;
  entries.sort((left, right) => right.distance - left.distance);
}

export class ExactVectorStore {
  readonly manifest: VectorExportManifest;
  readonly items: readonly VectorSearchItem[];
  readonly squaredNorms: Float32Array;

  constructor(config: VectorCorpusConfig) {
    this.manifest = loadManifest(config.manifestPath);
    this.items = loadItems(this.manifest.itemsPath);
    this.squaredNorms = loadSquaredNorms(this.manifest.squaredNormsPath, this.manifest.count);

    if (this.items.length !== this.manifest.count) {
      throw new Error(
        `vector export item count mismatch for ${config.corpus}: expected ${this.manifest.count}, got ${this.items.length}`,
      );
    }
    if (!existsSync(this.manifest.vectorsPath)) {
      throw new Error(`vector export vector file not found: ${this.manifest.vectorsPath}`);
    }
  }

  search(
    queryVector: readonly number[] | Float32Array,
    limit = 10,
  ): VectorSearchResult[] {
    assertFinitePositiveInteger("limit", limit);

    const normalizedQuery = normalizeQueryVector(queryVector, this.manifest.dimensions);
    const querySquaredNorm = computeSquaredNorm(normalizedQuery);
    const dimensions = this.manifest.dimensions;
    const bytesPerVector = dimensions * Float32Array.BYTES_PER_ELEMENT;
    const rowsPerChunk = Math.max(1, Math.floor(SCAN_BUFFER_BYTES / bytesPerVector));
    const chunkBuffer = Buffer.allocUnsafe(rowsPerChunk * bytesPerVector);
    const fd = openSync(this.manifest.vectorsPath, "r");
    const bestEntries: TopEntry[] = [];

    try {
      for (let rowOffset = 0; rowOffset < this.manifest.count; rowOffset += rowsPerChunk) {
        const rowsThisChunk = Math.min(rowsPerChunk, this.manifest.count - rowOffset);
        const bytesToRead = rowsThisChunk * bytesPerVector;
        const bytesRead = readSync(
          fd,
          chunkBuffer,
          0,
          bytesToRead,
          rowOffset * bytesPerVector,
        );
        if (bytesRead !== bytesToRead) {
          throw new Error(
            `short read in vector export ${this.manifest.vectorsPath}: expected ${bytesToRead}, got ${bytesRead}`,
          );
        }

        const vectors = new Float32Array(
          chunkBuffer.buffer,
          chunkBuffer.byteOffset,
          rowsThisChunk * dimensions,
        );

        for (let localRow = 0; localRow < rowsThisChunk; localRow += 1) {
          const rowIndex = rowOffset + localRow;
          const baseIndex = localRow * dimensions;
          let dotProduct = 0;
          for (let dimensionIndex = 0; dimensionIndex < dimensions; dimensionIndex += 1) {
            dotProduct +=
              vectors[baseIndex + dimensionIndex]! * normalizedQuery[dimensionIndex]!;
          }

          const distance =
            querySquaredNorm + this.squaredNorms[rowIndex]! - 2 * dotProduct;
          upsertTopK(bestEntries, { rowIndex, distance }, limit);
        }
      }
    } finally {
      closeSync(fd);
    }

    return bestEntries
      .slice()
      .sort((left, right) => left.distance - right.distance)
      .map((entry, index) => ({
        ...this.items[entry.rowIndex]!,
        corpus: this.manifest.corpus,
        distance: Number(entry.distance.toFixed(10)),
        vector_rank: index + 1,
      }));
  }
}

const STORE_CACHE = new Map<string, ExactVectorStore>();

export function getExactVectorStore(config: VectorCorpusConfig): ExactVectorStore {
  const cacheKey = config.manifestPath;
  const existing = STORE_CACHE.get(cacheKey);
  if (existing) {
    return existing;
  }

  const store = new ExactVectorStore(config);
  STORE_CACHE.set(cacheKey, store);
  return store;
}

export function hasVectorExport(config: VectorCorpusConfig): boolean {
  return existsSync(config.manifestPath);
}

export function searchVectorCorpus(
  config: VectorCorpusConfig,
  queryVector: readonly number[] | Float32Array,
  limit = 10,
): VectorSearchResult[] {
  return getExactVectorStore(config).search(queryVector, limit);
}

export function searchDocumentsVector(
  queryVector: readonly number[] | Float32Array,
  limit = 10,
): VectorSearchResult[] {
  return searchVectorCorpus(TECH_DOCS_VECTOR_CONFIG, queryVector, limit);
}

export function searchNonConformitiesVector(
  queryVector: readonly number[] | Float32Array,
  limit = 10,
): VectorSearchResult[] {
  return searchVectorCorpus(NC_VECTOR_CONFIG, queryVector, limit);
}
