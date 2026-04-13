import { mkdirSync, openSync, readFileSync, readSync, writeFileSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HybridRetriever, type HybridCorpusName } from "../src/retrieval/hybrid-retriever.ts";
import { LanceDbRetrievalEngine } from "../src/retrieval/lancedb-engine.ts";
import {
  ExactVectorStore,
  NC_VECTOR_CONFIG,
  TECH_DOCS_VECTOR_CONFIG,
} from "../src/retrieval/vector-search.ts";

interface EvalCase {
  readonly case_id: string;
  readonly label: string;
  readonly query: string;
  readonly expected_tech_doc_prefixes: readonly string[];
  readonly expected_nc_prefixes: readonly string[];
  readonly review_note?: string;
}

interface CorpusBenchmarkResult {
  readonly representativeDoc: string;
  readonly hitAt5: boolean;
  readonly hitAt10: boolean;
  readonly topDocs: readonly string[];
  readonly queryVariants: readonly string[];
}

interface CaseBenchmarkResult {
  readonly caseId: string;
  readonly label: string;
  readonly query: string;
  readonly techDocs: {
    readonly export_exact: CorpusBenchmarkResult;
    readonly lancedb: CorpusBenchmarkResult;
  };
  readonly nonConformities: {
    readonly export_exact: CorpusBenchmarkResult;
    readonly lancedb: CorpusBenchmarkResult;
  };
}

type EngineName = "export_exact" | "lancedb";
type CorpusKey = "techDocs" | "nonConformities";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVAL_CASES_PATH = path.join(REPO_ROOT, "api", "test", "eval_cases.json");
const REVIEWS_DIR = path.join(REPO_ROOT, "backend-ts", "reviews");
const JSON_REPORT_PATH = path.join(REVIEWS_DIR, "l4b.5_retrieval_engine_benchmark.json");
const MARKDOWN_REPORT_PATH = path.join(REVIEWS_DIR, "l4b.5_retrieval_engine_benchmark.md");
const TOP_KS = [5, 10] as const;

const STORES = {
  tech_docs: new ExactVectorStore(TECH_DOCS_VECTOR_CONFIG),
  non_conformities: new ExactVectorStore(NC_VECTOR_CONFIG),
} as const;

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

function matchesPrefixes(name: string, prefixes: readonly string[]): boolean {
  const normalizedName = normalizeName(path.parse(name).name);
  return prefixes.some((prefix) => normalizedName.startsWith(normalizeName(prefix)));
}

function hitAtK(results: readonly string[], prefixes: readonly string[], k: number): boolean {
  return results.slice(0, k).some((doc) => matchesPrefixes(doc, prefixes));
}

function readEvalCases(): readonly EvalCase[] {
  const payload = JSON.parse(readFileSync(EVAL_CASES_PATH, "utf8")) as { readonly cases: readonly EvalCase[] };
  return payload.cases;
}

function findRepresentativeRow(
  store: ExactVectorStore,
  prefixes: readonly string[],
): { readonly rowIndex: number; readonly doc: string } {
  const rowIndex = store.items.findIndex((item) => matchesPrefixes(item.doc, prefixes));
  if (rowIndex < 0) {
    throw new Error(`No representative vector found for prefixes: ${prefixes.join(", ")}`);
  }
  return {
    rowIndex,
    doc: store.items[rowIndex]!.doc,
  };
}

function readVectorAtRow(store: ExactVectorStore, rowIndex: number): Float32Array {
  const dimensions = store.manifest.dimensions;
  const byteLength = dimensions * Float32Array.BYTES_PER_ELEMENT;
  const buffer = Buffer.allocUnsafe(byteLength);
  const fd = openSync(store.manifest.vectorsPath, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, byteLength, rowIndex * byteLength);
    if (bytesRead !== byteLength) {
      throw new Error(`Short read for row ${rowIndex}: expected ${byteLength}, got ${bytesRead}`);
    }
  } finally {
    closeSync(fd);
  }
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + byteLength));
}

async function runCorpusBenchmark(
  engineName: EngineName,
  corpus: HybridCorpusName,
  query: string,
  prefixes: readonly string[],
): Promise<CorpusBenchmarkResult> {
  const store = corpus === "tech_docs" ? STORES.tech_docs : STORES.non_conformities;
  const representative = findRepresentativeRow(store, prefixes);
  const vector = readVectorAtRow(store, representative.rowIndex);
  const vectorizer = {
    async embedQuery(): Promise<Float32Array> {
      return vector;
    },
  };

  const response =
    engineName === "export_exact"
      ? await new HybridRetriever(vectorizer).searchCorpus(corpus, query)
      : await new LanceDbRetrievalEngine(vectorizer).searchCorpus(corpus, query);

  const docs = response.results.map((item) => String(item.doc ?? ""));
  return {
    representativeDoc: representative.doc,
    hitAt5: hitAtK(docs, prefixes, 5),
    hitAt10: hitAtK(docs, prefixes, 10),
    topDocs: docs.slice(0, 5),
    queryVariants: [...response.debug.queryVariants],
  };
}

async function evaluateCase(input: EvalCase): Promise<CaseBenchmarkResult> {
  const [techExact, techLance, ncExact, ncLance] = await Promise.all([
    runCorpusBenchmark("export_exact", "tech_docs", input.query, input.expected_tech_doc_prefixes),
    runCorpusBenchmark("lancedb", "tech_docs", input.query, input.expected_tech_doc_prefixes),
    runCorpusBenchmark("export_exact", "non_conformities", input.query, input.expected_nc_prefixes),
    runCorpusBenchmark("lancedb", "non_conformities", input.query, input.expected_nc_prefixes),
  ]);

  return {
    caseId: input.case_id,
    label: input.label,
    query: input.query,
    techDocs: {
      export_exact: techExact,
      lancedb: techLance,
    },
    nonConformities: {
      export_exact: ncExact,
      lancedb: ncLance,
    },
  };
}

function summarize(results: readonly CaseBenchmarkResult[]): Record<string, { hits: number; total: number; ratio: number }> {
  const summary: Record<string, { hits: number; total: number; ratio: number }> = {};
  for (const engine of ["export_exact", "lancedb"] as const) {
    for (const corpus of ["techDocs", "nonConformities"] as const) {
      for (const k of TOP_KS) {
        const key = `${engine}_${corpus}_hit@${k}`;
        const hits = results.reduce((count, row) => {
          const corpusResult = row[corpus][engine];
          return count + (k === 5 ? Number(corpusResult.hitAt5) : Number(corpusResult.hitAt10));
        }, 0);
        summary[key] = {
          hits,
          total: results.length,
          ratio: Number((hits / results.length).toFixed(3)),
        };
      }
    }
  }
  return summary;
}

function chooseDefaultRuntime(summary: Record<string, { hits: number }>): {
  readonly selectedDefault: EngineName;
  readonly rationale: string;
} {
  const exactTotal =
    summary["export_exact_techDocs_hit@10"]!.hits + summary["export_exact_nonConformities_hit@10"]!.hits;
  const lanceTotal =
    summary["lancedb_techDocs_hit@10"]!.hits + summary["lancedb_nonConformities_hit@10"]!.hits;

  if (lanceTotal >= exactTotal) {
    return {
      selectedDefault: "lancedb",
      rationale: "LanceDB is at least at parity on hit@10 across both corpora in the offline engine benchmark.",
    };
  }

  return {
    selectedDefault: "export_exact",
    rationale: "export_exact keeps a better hit@10 total on the offline engine benchmark, so the fallback remains the default.",
  };
}

function buildMarkdownReport(document: {
  readonly generatedAt: string;
  readonly summary: Record<string, { hits: number; total: number; ratio: number }>;
  readonly decision: { readonly selectedDefault: EngineName; readonly rationale: string };
  readonly cases: readonly CaseBenchmarkResult[];
}): string {
  const lines = [
    "# L4B.5 Retrieval Engine Benchmark",
    "",
    `- Generated at: ${document.generatedAt}`,
    "- Scope: offline engine comparison on the repo mini-corpus",
    "- Method: same rewritten queries and representative in-corpus vectors reused across `export_exact` and `lancedb`",
    `- Decision: \`${document.decision.selectedDefault}\``,
    `- Rationale: ${document.decision.rationale}`,
    "",
    "## Summary",
    "",
  ];

  for (const [key, value] of Object.entries(document.summary)) {
    lines.push(`- \`${key}\`: ${value.hits}/${value.total} (${value.ratio})`);
  }

  lines.push("", "## Cases", "");
  for (const item of document.cases) {
    lines.push(`### ${item.caseId} - ${item.label}`);
    lines.push("");
    lines.push(`- Query: \`${item.query}\``);
    lines.push(
      `- Tech docs: export_exact hit@10=${item.techDocs.export_exact.hitAt10}, lancedb hit@10=${item.techDocs.lancedb.hitAt10}`,
    );
    lines.push(
      `- Non-conformities: export_exact hit@10=${item.nonConformities.export_exact.hitAt10}, lancedb hit@10=${item.nonConformities.lancedb.hitAt10}`,
    );
    lines.push(
      `- Top tech docs: export_exact=\`${item.techDocs.export_exact.topDocs[0] ?? ""}\`, lancedb=\`${item.techDocs.lancedb.topDocs[0] ?? ""}\``,
    );
    lines.push(
      `- Top NC: export_exact=\`${item.nonConformities.export_exact.topDocs[0] ?? ""}\`, lancedb=\`${item.nonConformities.lancedb.topDocs[0] ?? ""}\``,
    );
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const cases = readEvalCases();
  const results = await Promise.all(cases.map((item) => evaluateCase(item)));
  const summary = summarize(results);
  const decision = chooseDefaultRuntime(summary);
  const document = {
    generatedAt: new Date().toISOString(),
    benchmarkType: "offline-engine-parity-v1",
    vectorIndexBuilt: false,
    cases: results,
    summary,
    decision,
  };

  mkdirSync(REVIEWS_DIR, { recursive: true });
  writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  writeFileSync(MARKDOWN_REPORT_PATH, buildMarkdownReport(document), "utf8");
  process.stdout.write(`${JSON.stringify({ summary, decision }, null, 2)}\n`);
}

await main();
