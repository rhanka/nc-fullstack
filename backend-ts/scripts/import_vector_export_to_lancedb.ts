import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect, Index } from "@lancedb/lancedb";

type CorpusName = "tech_docs" | "non_conformities";

interface VectorExportManifest {
  readonly version: "vector-export-v1";
  readonly corpus: CorpusName;
  readonly embeddingModel: string;
  readonly metric: "l2";
  readonly dimensions: number;
  readonly count: number;
  readonly vectorsPath: string;
  readonly squaredNormsPath: string;
  readonly itemsPath: string;
}

interface CorpusConfig {
  readonly corpus: CorpusName;
  readonly exportRoot: string;
  readonly lancedbUri: string;
  readonly tableName: string;
}

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const API_DATA_ROOT = path.join(REPO_ROOT, "api", "data");
const DEFAULT_TABLE_NAME = process.env.LANCEDB_TABLE_NAME?.trim() || "chunks";
const BUILD_VECTOR_INDEX = process.env.LANCEDB_BUILD_VECTOR_INDEX === "1";

const CORPORA: Record<CorpusName, CorpusConfig> = {
  tech_docs: {
    corpus: "tech_docs",
    exportRoot: path.join(
      API_DATA_ROOT,
      process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs",
      "vector-export",
    ),
    lancedbUri: path.join(
      API_DATA_ROOT,
      process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs",
      "lancedb",
    ),
    tableName: DEFAULT_TABLE_NAME,
  },
  non_conformities: {
    corpus: "non_conformities",
    exportRoot: path.join(
      API_DATA_ROOT,
      process.env.NC_DIR?.trim() || "a220-non-conformities",
      "vector-export",
    ),
    lancedbUri: path.join(
      API_DATA_ROOT,
      process.env.NC_DIR?.trim() || "a220-non-conformities",
      "lancedb",
    ),
    tableName: DEFAULT_TABLE_NAME,
  },
};

function loadManifest(exportRoot: string): VectorExportManifest {
  const manifestPath = path.join(exportRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`missing vector export manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as VectorExportManifest;
}

function loadItems(exportRoot: string, manifest: VectorExportManifest): readonly Record<string, unknown>[] {
  const itemsPath = path.join(exportRoot, manifest.itemsPath);
  return readFileSync(itemsPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readVectorsBatch(
  fileDescriptor: number,
  startRow: number,
  rowCount: number,
  dimensions: number,
): Float32Array {
  const bytesPerVector = dimensions * Float32Array.BYTES_PER_ELEMENT;
  const byteLength = rowCount * bytesPerVector;
  const buffer = Buffer.allocUnsafe(byteLength);
  const bytesRead = readSync(fileDescriptor, buffer, 0, byteLength, startRow * bytesPerVector);
  if (bytesRead !== byteLength) {
    throw new Error(`short read while importing LanceDB: expected ${byteLength}, got ${bytesRead}`);
  }
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + byteLength));
}

function chunkRows(
  items: readonly Record<string, unknown>[],
  vectors: Float32Array,
  startRow: number,
  rowCount: number,
  dimensions: number,
  corpus: CorpusName,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let localIndex = 0; localIndex < rowCount; localIndex += 1) {
    const item = items[startRow + localIndex]!;
    const vectorStart = localIndex * dimensions;
    const vector = Array.from(vectors.slice(vectorStart, vectorStart + dimensions));
    const ataCode =
      typeof item.ATA_code === "string"
        ? item.ATA_code
        : typeof item.ata_code === "string"
          ? item.ata_code
          : null;
    const ataCategory =
      typeof item.ATA_category === "string"
        ? item.ATA_category
        : typeof item.ata_category === "string"
          ? item.ata_category
          : null;

    rows.push({
      doc: String(item.doc ?? item.chunk_id ?? ""),
      chunk_id: String(item.chunk_id ?? item.doc ?? ""),
      content: String(item.content ?? ""),
      vector,
      source_kind: corpus,
      ata_code: ataCode ?? "",
      ata_category: ataCategory ?? "",
      metadata_json: JSON.stringify(item),
    });
  }
  return rows;
}

async function importCorpus(config: CorpusConfig, batchSize: number): Promise<Record<string, unknown>> {
  const manifest = loadManifest(config.exportRoot);
  const items = loadItems(config.exportRoot, manifest);
  const vectorsPath = path.join(config.exportRoot, manifest.vectorsPath);
  const db = await connect(config.lancedbUri);

  try {
    await db.dropTable(config.tableName);
  } catch {
    // First build or table already absent.
  }

  const fd = openSync(vectorsPath, "r");
  try {
    let table = null as Awaited<ReturnType<typeof db.createTable>> | null;
    for (let startRow = 0; startRow < manifest.count; startRow += batchSize) {
      const rowCount = Math.min(batchSize, manifest.count - startRow);
      const vectors = readVectorsBatch(fd, startRow, rowCount, manifest.dimensions);
      const rows = chunkRows(items, vectors, startRow, rowCount, manifest.dimensions, config.corpus);
      if (!table) {
        table = await db.createTable(config.tableName, rows, { mode: "overwrite" });
      } else {
        await table.add(rows);
      }
    }

    if (!table) {
      throw new Error(`no rows imported for ${config.corpus}`);
    }

    await table.createIndex("content", {
      config: Index.fts({
        baseTokenizer: "simple",
        lowercase: true,
        asciiFolding: true,
      }),
    });
    if (BUILD_VECTOR_INDEX && manifest.count >= 256) {
      await table.createIndex("vector");
      await table.waitForIndex(["content_idx", "vector_idx"], 120);
    } else {
      await table.waitForIndex(["content_idx"], 120);
    }

    return {
      corpus: config.corpus,
      lancedbUri: config.lancedbUri,
      tableName: config.tableName,
      rows: manifest.count,
      dimensions: manifest.dimensions,
      vectorIndexBuilt: BUILD_VECTOR_INDEX && manifest.count >= 256,
    };
  } finally {
    closeSync(fd);
  }
}

async function main(): Promise<void> {
  const target = (process.argv[2] ?? "all").trim();
  const batchSize = Number(process.env.LANCEDB_IMPORT_BATCH_SIZE ?? "256");
  const selected =
    target === "all"
      ? [CORPORA.tech_docs, CORPORA.non_conformities]
      : [CORPORA[target as CorpusName]];

  if (selected.some((config) => !config)) {
    throw new Error("usage: node scripts/import_vector_export_to_lancedb.ts <tech_docs|non_conformities|all>");
  }

  const results = [];
  for (const config of selected) {
    results.push(await importCorpus(config, batchSize));
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

await main();
