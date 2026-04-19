import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenAIImageCaptionClient,
  normalizeImageCaptionAnalysis,
  type ImageCaptionAnalysis,
  type ImageCaptionClient,
} from "./ocr-tech-docs.ts";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

type OcrImage = {
  readonly id?: string;
  readonly imageBase64?: string;
  readonly image_base64?: string;
};

type OcrPage = {
  readonly markdown?: string;
  readonly markdown_alt?: string;
  readonly images?: readonly OcrImage[];
};

type OcrDocument = {
  readonly pages?: readonly OcrPage[];
  readonly markdown?: string;
  readonly ocrResponse?: {
    readonly pages?: readonly OcrPage[];
  };
};

export interface OcrCaptionBenchmarkPaths {
  readonly ocrDir: string;
  readonly outputDir: string;
}

export interface OcrCaptionBenchmarkSample {
  readonly doc: string;
  readonly ocrPath: string;
  readonly markdown: string;
  readonly imageDataUrls: readonly string[];
  readonly imageCount: number;
  readonly approxImageBytes: number;
  readonly stratum: "small" | "medium" | "large" | "multi";
}

export interface OcrCaptionBenchmarkModelResult {
  readonly model: string;
  readonly provider: string;
  readonly status: "ok";
  readonly durationMs: number;
  readonly analysis: ImageCaptionAnalysis;
  readonly outputPath: string;
}

export interface OcrCaptionBenchmarkModelError {
  readonly model: string;
  readonly provider: string;
  readonly status: "error";
  readonly durationMs: number;
  readonly error: string;
  readonly outputPath: string;
}

export type OcrCaptionBenchmarkModelRun = OcrCaptionBenchmarkModelResult | OcrCaptionBenchmarkModelError;

export interface OcrCaptionBenchmarkSampleResult {
  readonly sample: OcrCaptionBenchmarkSample;
  readonly results: readonly OcrCaptionBenchmarkModelRun[];
}

export interface OcrCaptionBenchmarkSummary {
  readonly models: readonly string[];
  readonly sampleLimit: number;
  readonly sampleCount: number;
  readonly outputDir: string;
  readonly samplesPath: string;
  readonly resultsPath: string;
  readonly reportPath: string;
  readonly results: readonly OcrCaptionBenchmarkSampleResult[];
}

export interface OcrCaptionBenchmarkOptions {
  readonly ocrDir: string;
  readonly outputDir: string;
  readonly models: readonly string[];
  readonly limit: number;
  readonly imageDetail?: string;
  readonly clientFactory?: (model: string) => ImageCaptionClient;
  readonly onProgress?: (event: OcrCaptionBenchmarkProgressEvent) => void;
}

export interface OcrCaptionBenchmarkProgressEvent {
  readonly phase: "start" | "ok" | "error";
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly doc: string;
  readonly model: string;
  readonly durationMs?: number;
  readonly outputPath?: string;
  readonly error?: string;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteFile(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tmpPath = filePath + ".tmp-" + String(process.pid);
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function isRawOcrJson(fileName: string): boolean {
  return (
    fileName.endsWith(".json") &&
    !fileName.endsWith(".image-caption.json") &&
    !fileName.endsWith("__with_img_desc.json")
  );
}

function pageDocFromJsonFile(fileName: string): string {
  return fileName.replace(/\.json$/iu, ".pdf");
}

function normalizeImageDataUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  return "data:image/jpeg;base64," + trimmed;
}

function extractFirstPage(document: OcrDocument): OcrPage | null {
  const pages = document.pages ?? document.ocrResponse?.pages ?? [];
  return pages[0] ?? null;
}

function extractMarkdown(document: OcrDocument): string {
  const page = extractFirstPage(document);
  return String(page?.markdown_alt ?? page?.markdown ?? document.markdown ?? "").trim();
}

function extractImageDataUrls(document: OcrDocument): string[] {
  const page = extractFirstPage(document);
  if (!page?.images) {
    return [];
  }
  return page.images
    .map((image) => image.imageBase64 ?? image.image_base64 ?? "")
    .map((value) => normalizeImageDataUrl(value))
    .filter(Boolean);
}

function approxBytesFromDataUrl(imageDataUrl: string): number {
  const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",").pop() ?? "" : imageDataUrl;
  return Math.floor((base64.length * 3) / 4);
}

function classifyStratum(imageCount: number, approxImageBytes: number): OcrCaptionBenchmarkSample["stratum"] {
  if (imageCount >= 2) {
    return "multi";
  }
  if (approxImageBytes < 75_000) {
    return "small";
  }
  if (approxImageBytes < 160_000) {
    return "medium";
  }
  return "large";
}

function stableSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
}

function evenlyPick<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) {
    return [];
  }
  if (count >= items.length) {
    return [...items];
  }
  if (count === 1) {
    return [items[0]!];
  }
  const picked: T[] = [];
  const last = items.length - 1;
  for (let index = 0; index < count; index += 1) {
    picked.push(items[Math.round((index * last) / (count - 1))]!);
  }
  return picked;
}

export function getDefaultOcrCaptionBenchmarkPaths(): OcrCaptionBenchmarkPaths {
  const root = path.join(API_ROOT, "data", TECH_DOCS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return {
    ocrDir: path.join(root, "ocr"),
    outputDir: path.join(root, "benchmarks", "ocr-caption-" + stamp),
  };
}

export function listOcrCaptionBenchmarkCandidates(ocrDir: string): OcrCaptionBenchmarkSample[] {
  if (!existsSync(ocrDir)) {
    throw new Error("Missing OCR directory: " + ocrDir);
  }

  const samples: OcrCaptionBenchmarkSample[] = [];
  for (const fileName of readdirSync(ocrDir).filter(isRawOcrJson).sort((left, right) => left.localeCompare(right))) {
    const ocrPath = path.join(ocrDir, fileName);
    const document = readJsonFile<OcrDocument>(ocrPath);
    const imageDataUrls = extractImageDataUrls(document);
    if (imageDataUrls.length === 0) {
      continue;
    }
    const approxImageBytes = imageDataUrls.reduce((sum, imageDataUrl) => sum + approxBytesFromDataUrl(imageDataUrl), 0);
    samples.push({
      doc: pageDocFromJsonFile(fileName),
      ocrPath,
      markdown: extractMarkdown(document),
      imageDataUrls,
      imageCount: imageDataUrls.length,
      approxImageBytes,
      stratum: classifyStratum(imageDataUrls.length, approxImageBytes),
    });
  }
  return samples;
}

export function selectOcrCaptionBenchmarkSamples(
  candidates: readonly OcrCaptionBenchmarkSample[],
  limit: number,
): OcrCaptionBenchmarkSample[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) {
    return [];
  }

  const byStratum = new Map<OcrCaptionBenchmarkSample["stratum"], OcrCaptionBenchmarkSample[]>();
  for (const candidate of candidates) {
    const bucket = byStratum.get(candidate.stratum) ?? [];
    bucket.push(candidate);
    byStratum.set(candidate.stratum, bucket);
  }

  const strata: readonly OcrCaptionBenchmarkSample["stratum"][] = ["small", "medium", "large", "multi"];
  const basePerStratum = Math.max(1, Math.floor(normalizedLimit / strata.length));
  const selected = new Map<string, OcrCaptionBenchmarkSample>();
  for (const stratum of strata) {
    const bucket = byStratum.get(stratum) ?? [];
    for (const sample of evenlyPick(bucket, basePerStratum)) {
      selected.set(sample.doc, sample);
    }
  }

  const sortedCandidates = [...candidates].sort((left, right) => left.doc.localeCompare(right.doc));
  let cursor = 0;
  while (selected.size < normalizedLimit && cursor < sortedCandidates.length) {
    const sample = sortedCandidates[cursor]!;
    selected.set(sample.doc, sample);
    cursor += 1;
  }

  return [...selected.values()]
    .sort((left, right) => left.doc.localeCompare(right.doc))
    .slice(0, normalizedLimit);
}

function createDefaultClient(model: string, imageDetail?: string): ImageCaptionClient {
  return new OpenAIImageCaptionClient({ model, imageDetail });
}

function readExistingRun(outputPath: string): OcrCaptionBenchmarkModelRun | null {
  if (!existsSync(outputPath)) {
    return null;
  }
  const parsed = readJsonFile<Record<string, unknown>>(outputPath);
  const model = String(parsed.model ?? "");
  const provider = String(parsed.provider ?? "");
  const durationMs = Number(parsed.durationMs ?? 0);
  if (parsed.status === "error") {
    return {
      model,
      provider,
      status: "error",
      durationMs,
      error: String(parsed.error ?? "unknown cached benchmark error"),
      outputPath,
    };
  }
  return {
    model,
    provider,
    status: "ok",
    durationMs,
    analysis: normalizeImageCaptionAnalysis(parsed.analysis),
    outputPath,
  };
}

async function runModel(
  sample: OcrCaptionBenchmarkSample,
  model: string,
  outputDir: string,
  client: ImageCaptionClient,
): Promise<OcrCaptionBenchmarkModelRun> {
  const startedAt = Date.now();
  const outputPath = path.join(outputDir, "results", stableSlug(sample.doc) + "." + stableSlug(model) + ".json");
  const existing = readExistingRun(outputPath);
  if (existing) {
    return existing;
  }
  try {
    const analysis = await client.analyzePage({
      doc: sample.doc,
      markdown: sample.markdown,
      imageDataUrls: sample.imageDataUrls,
    });
    const durationMs = Date.now() - startedAt;
    const result: OcrCaptionBenchmarkModelResult = {
      model,
      provider: client.provider,
      status: "ok",
      durationMs,
      analysis,
      outputPath,
    };
    atomicWriteFile(
      outputPath,
      JSON.stringify(
        {
          sample: {
            doc: sample.doc,
            imageCount: sample.imageCount,
            approxImageBytes: sample.approxImageBytes,
            stratum: sample.stratum,
          },
          model,
          provider: client.provider,
          status: result.status,
          durationMs,
          analysis,
        },
        null,
        2,
      ) + "\n",
    );
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const result: OcrCaptionBenchmarkModelError = {
      model,
      provider: client.provider,
      status: "error",
      durationMs,
      error: message,
      outputPath,
    };
    atomicWriteFile(
      outputPath,
      JSON.stringify(
        {
          sample: {
            doc: sample.doc,
            imageCount: sample.imageCount,
            approxImageBytes: sample.approxImageBytes,
            stratum: sample.stratum,
          },
          model,
          provider: client.provider,
          status: result.status,
          durationMs,
          error: message,
        },
        null,
        2,
      ) + "\n",
    );
    return result;
  }
}

function isOkResult(entry: OcrCaptionBenchmarkModelRun): entry is OcrCaptionBenchmarkModelResult {
  return entry.status === "ok";
}

function isErrorResult(entry: OcrCaptionBenchmarkModelRun): entry is OcrCaptionBenchmarkModelError {
  return entry.status === "error";
}

function renderMarkdownReport(summary: OcrCaptionBenchmarkSummary): string {
  const lines = [
    "# OCR Caption Benchmark",
    "",
    "## Scope",
    "",
    "Compares OCR-extracted image caption quality across models using the same Mistral OCR image crops and OCR Markdown context. Rendered full-page PDF images are out of scope.",
    "",
    "## Run",
    "",
    "- Models: " + summary.models.join(", "),
    "- Samples: " + String(summary.sampleCount),
    "- Output directory: " + summary.outputDir,
    "",
    "## Samples",
    "",
    "| Doc | Stratum | Images | OK models | Errors |",
    "| --- | --- | ---: | --- | --- |",
  ];
  for (const result of summary.results) {
    const okModels = result.results.filter(isOkResult).map((entry) => entry.model);
    const errors = result.results
      .filter(isErrorResult)
      .map((entry) => entry.model + ": " + entry.error.replace(/\|/gu, "\\|"));
    lines.push(
      "| " +
        result.sample.doc.replace(/\|/gu, "\\|") +
        " | " +
        result.sample.stratum +
        " | " +
        String(result.sample.imageCount) +
        " | " +
        okModels.join(", ") +
        " | " +
        errors.join("<br>") +
        " |",
    );
  }
  lines.push(
    "",
    "## Human Evaluation",
    "",
    "Manual scoring is intentionally separate from generation. Review the JSON files under results/ and fill the final assessment with: schema validity, technical depth, grounding, retrieval usefulness, and non-content detection.",
  );
  return lines.join("\n") + "\n";
}

export async function runOcrCaptionBenchmark(
  options: OcrCaptionBenchmarkOptions,
): Promise<OcrCaptionBenchmarkSummary> {
  if (options.models.length === 0) {
    throw new Error("At least one benchmark model is required");
  }
  const candidates = listOcrCaptionBenchmarkCandidates(options.ocrDir);
  const samples = selectOcrCaptionBenchmarkSamples(candidates, options.limit);
  mkdirSync(options.outputDir, { recursive: true });
  const clientFactory = options.clientFactory ?? ((model: string) => createDefaultClient(model, options.imageDetail));

  const results: OcrCaptionBenchmarkSampleResult[] = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    const modelResults: OcrCaptionBenchmarkModelRun[] = [];
    for (const model of options.models) {
      options.onProgress?.({
        phase: "start",
        sampleIndex: sampleIndex + 1,
        sampleCount: samples.length,
        doc: sample.doc,
        model,
      });
      const modelResult = await runModel(sample, model, options.outputDir, clientFactory(model));
      modelResults.push(modelResult);
      options.onProgress?.({
        phase: modelResult.status,
        sampleIndex: sampleIndex + 1,
        sampleCount: samples.length,
        doc: sample.doc,
        model,
        durationMs: modelResult.durationMs,
        outputPath: modelResult.outputPath,
        error: modelResult.status === "error" ? modelResult.error : undefined,
      });
    }
    results.push({ sample, results: modelResults });
  }

  const samplesPath = path.join(options.outputDir, "samples.json");
  const resultsPath = path.join(options.outputDir, "results.json");
  const reportPath = path.join(options.outputDir, "REPORT.md");

  atomicWriteFile(samplesPath, JSON.stringify(samples, null, 2) + "\n");
  const summary: OcrCaptionBenchmarkSummary = {
    models: options.models,
    sampleLimit: options.limit,
    sampleCount: samples.length,
    outputDir: options.outputDir,
    samplesPath,
    resultsPath,
    reportPath,
    results,
  };
  atomicWriteFile(resultsPath, JSON.stringify(summary, null, 2) + "\n");
  atomicWriteFile(reportPath, renderMarkdownReport(summary));

  return summary;
}

export function parseBenchmarkModels(value: string | undefined): string[] {
  const parsed = (value ?? "gpt-5.4-nano,gpt-5.4")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed));
}
