import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  A220_IMAGE_CAPTION_V2_PROMPT,
  extractResponseText,
  normalizeImageCaptionV2,
  routeImageCaptionV2,
  type ImageCaptionV2,
} from "./ocr-caption-routing-calibration.ts";
import {
  atomicWriteFile,
  captionAuditJsonPath,
  captionJsonPath,
  extractImageDataUrls,
  extractMarkdown,
  findOcrJsonPath,
  getDefaultOcrTechDocsPaths,
  listPagePdfDocs,
  pageBaseFromDoc,
  readJsonFile,
  type BuildPreparedTechDocsCsvOptions,
  type ImageCaptionReasoning,
  type OcrDocument,
} from "./ocr-tech-docs.ts";

export const OCR_CAPTION_BATCH_SCHEMA_VERSION = "a220_ocr_caption_batch_v1";

export type OcrCaptionBatchPhase = "primary" | "deep";
export type OcrCaptionBatchMode = "missing" | "force";

export interface OcrCaptionBatchRequestRecord {
  readonly customId: string;
  readonly doc: string;
  readonly ocrPath: string;
  readonly captionPath: string;
  readonly auditPath: string;
  readonly imageFileIds: readonly string[];
  readonly imageCount: number;
}

export interface OcrCaptionBatchManifest {
  readonly schema_version: typeof OCR_CAPTION_BATCH_SCHEMA_VERSION;
  readonly phase: OcrCaptionBatchPhase;
  readonly model: string;
  readonly reasoning: ImageCaptionReasoning;
  readonly imageDetail: string;
  readonly maxOutputTokens: number;
  readonly endpoint: "/v1/responses";
  readonly completionWindow: "24h";
  readonly createdAt: string;
  readonly batchDir: string;
  readonly inputJsonlPath: string;
  readonly inputFileId: string;
  readonly batchId: string;
  readonly status: string;
  readonly requestCount: number;
  readonly requests: readonly OcrCaptionBatchRequestRecord[];
  readonly outputFileId?: string | null;
  readonly errorFileId?: string | null;
}

export interface OcrCaptionVisionFileCheckpoint {
  readonly schema_version: "a220_ocr_caption_batch_vision_files_v1";
  readonly files: Record<string, string>;
}

export interface OcrCaptionBatchObject {
  readonly id: string;
  readonly status: string;
  readonly input_file_id?: string;
  readonly output_file_id?: string | null;
  readonly error_file_id?: string | null;
}

export interface OcrCaptionBatchApiClient {
  uploadFile(input: {
    readonly fileName: string;
    readonly contentType: string;
    readonly content: Uint8Array | string;
    readonly purpose: "vision" | "batch";
  }): Promise<string>;
  createBatch(input: {
    readonly inputFileId: string;
    readonly endpoint: "/v1/responses";
    readonly completionWindow: "24h";
  }): Promise<OcrCaptionBatchObject>;
  retrieveBatch(batchId: string): Promise<OcrCaptionBatchObject>;
  downloadFile(fileId: string): Promise<string>;
}

export interface OcrCaptionBatchCreateOptions extends BuildPreparedTechDocsCsvOptions {
  readonly batchDir: string;
  readonly phase: OcrCaptionBatchPhase;
  readonly mode: OcrCaptionBatchMode;
  readonly model: string;
  readonly reasoning: ImageCaptionReasoning;
  readonly imageDetail: string;
  readonly maxOutputTokens: number;
  readonly client: OcrCaptionBatchApiClient;
}

export interface OcrCaptionBatchCreateResult {
  readonly manifestPath: string;
  readonly manifest: OcrCaptionBatchManifest;
  readonly skipped: number;
}

export interface OcrCaptionBatchImportOptions {
  readonly manifestPath: string;
  readonly client: OcrCaptionBatchApiClient;
  readonly outputJsonlPath?: string;
}

export interface OcrCaptionBatchImportResult {
  readonly manifestPath: string;
  readonly batchId: string;
  readonly status: string;
  readonly imported: number;
  readonly failed: number;
  readonly routedNano: number;
  readonly routedDeep: number;
  readonly errors: readonly string[];
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function defaultOcrCaptionBatchRoot(): string {
  const defaults = getDefaultOcrTechDocsPaths();
  return path.join(path.dirname(defaults.ocrDir), "ocr-caption-batches");
}

export function defaultOcrCaptionBatchDir(phase: OcrCaptionBatchPhase, date = new Date()): string {
  return path.join(defaultOcrCaptionBatchRoot(), phase + "-" + timestampSlug(date));
}

export function latestOcrCaptionBatchManifest(rootDir = defaultOcrCaptionBatchRoot()): string {
  if (!existsSync(rootDir)) {
    throw new Error("No OCR caption batch directory found: " + rootDir);
  }
  const manifests = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name, "manifest.json"))
    .filter(existsSync)
    .map((manifestPath) => ({ manifestPath, mtimeMs: statSync(manifestPath).mtimeMs }))
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.manifestPath.localeCompare(right.manifestPath));
  const latest = manifests.at(-1)?.manifestPath;
  if (!latest) {
    throw new Error("No OCR caption batch manifest found under: " + rootDir);
  }
  return latest;
}

function slugCustomId(phase: OcrCaptionBatchPhase, doc: string): string {
  return (
    phase +
    ":" +
    pageBaseFromDoc(doc)
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 180)
  );
}

function visionFileCheckpointPath(batchDir: string): string {
  return path.join(batchDir, "vision-files.json");
}

function readVisionFileCheckpoint(batchDir: string): OcrCaptionVisionFileCheckpoint {
  const checkpointPath = visionFileCheckpointPath(batchDir);
  if (!existsSync(checkpointPath)) {
    return { schema_version: "a220_ocr_caption_batch_vision_files_v1", files: {} };
  }
  return readJsonFile<OcrCaptionVisionFileCheckpoint>(checkpointPath);
}

function writeVisionFileCheckpoint(batchDir: string, checkpoint: OcrCaptionVisionFileCheckpoint): void {
  atomicWriteFile(visionFileCheckpointPath(batchDir), JSON.stringify(checkpoint, null, 2) + "\n");
}

function visionFileCheckpointKey(doc: string, imageIndex: number): string {
  return pageBaseFromDoc(doc) + "#image-" + String(imageIndex + 1);
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string; extension: string } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/u);
  const mimeType = match?.[1] ?? "image/png";
  const payload = match?.[2] ?? dataUrl.replace(/^data:image\/[^;]+;base64,/u, "");
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  return {
    bytes: new Uint8Array(Buffer.from(payload, "base64")),
    mimeType,
    extension,
  };
}

function buildResponseBody(input: {
  readonly doc: string;
  readonly markdown: string;
  readonly imageFileIds: readonly string[];
  readonly model: string;
  readonly reasoning: ImageCaptionReasoning;
  readonly imageDetail: string;
  readonly maxOutputTokens: number;
}): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text:
        A220_IMAGE_CAPTION_V2_PROMPT +
        "\n\nDocument page: " +
        input.doc +
        "\n\nOCR markdown context:\n" +
        input.markdown.slice(0, 8000),
    },
    ...input.imageFileIds.map((fileId) => ({
      type: "input_image",
      file_id: fileId,
      detail: input.imageDetail,
    })),
  ];
  const body: Record<string, unknown> = {
    model: input.model,
    input: [{ role: "user", content }],
    text: { format: { type: "json_object" } },
    max_output_tokens:
      Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0 ? input.maxOutputTokens : 6000,
  };
  if (input.reasoning !== "none") {
    body.reasoning = { effort: input.reasoning };
  }
  return body;
}

function shouldIncludeDoc(options: OcrCaptionBatchCreateOptions, doc: string): boolean {
  if (options.phase === "primary") {
    return options.mode === "force" || !existsSync(captionJsonPath(options.ocrDir, doc));
  }
  if (!existsSync(captionAuditJsonPath(options.ocrDir, doc))) {
    return false;
  }
  const audit = readJsonFile<{ route?: string; selectedModel?: string }>(captionAuditJsonPath(options.ocrDir, doc));
  return audit.route === "gpt-5.4" && audit.selectedModel !== "gpt-5.4";
}

async function uploadVisionFiles(
  client: OcrCaptionBatchApiClient,
  batchDir: string,
  checkpoint: OcrCaptionVisionFileCheckpoint,
  doc: string,
  imageDataUrls: readonly string[],
): Promise<string[]> {
  const fileIds: string[] = [];
  for (const [index, dataUrl] of imageDataUrls.entries()) {
    const checkpointKey = visionFileCheckpointKey(doc, index);
    const checkpointedFileId = checkpoint.files[checkpointKey];
    if (checkpointedFileId) {
      fileIds.push(checkpointedFileId);
      continue;
    }
    const image = dataUrlToBytes(dataUrl);
    const fileName = pageBaseFromDoc(doc) + "_image_" + String(index + 1) + "." + image.extension;
    const fileId = await uploadFileWithRetry(client, {
      fileName,
      contentType: image.mimeType,
      content: image.bytes,
      purpose: "vision",
    });
    checkpoint.files[checkpointKey] = fileId;
    writeVisionFileCheckpoint(batchDir, checkpoint);
    fileIds.push(fileId);
  }
  return fileIds;
}

async function uploadFileWithRetry(
  client: OcrCaptionBatchApiClient,
  input: {
    readonly fileName: string;
    readonly contentType: string;
    readonly content: Uint8Array | string;
    readonly purpose: "vision" | "batch";
  },
): Promise<string> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.uploadFile(input);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      await sleep(750 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function uploadBatchInputFile(client: OcrCaptionBatchApiClient, inputJsonlPath: string): Promise<string> {
  return await uploadFileWithRetry(client, {
    fileName: "input.jsonl",
    contentType: "application/jsonl",
    content: readFileSync(inputJsonlPath),
    purpose: "batch",
  });
}

export async function createOcrCaptionBatch(
  options: OcrCaptionBatchCreateOptions,
): Promise<OcrCaptionBatchCreateResult> {
  ensureDir(options.batchDir);
  const visionCheckpoint = readVisionFileCheckpoint(options.batchDir);
  const requests: OcrCaptionBatchRequestRecord[] = [];
  const jsonlLines: string[] = [];
  let skipped = 0;

  for (const doc of listPagePdfDocs(options.pagesDir, options.limit)) {
    if (!shouldIncludeDoc(options, doc)) {
      skipped += 1;
      continue;
    }
    const ocrPath = findOcrJsonPath(options.ocrDir, doc, false);
    if (!ocrPath) {
      skipped += 1;
      continue;
    }
    const ocrDocument = readJsonFile<OcrDocument>(ocrPath);
    const markdown = extractMarkdown(ocrDocument, true);
    const imageDataUrls = extractImageDataUrls(ocrDocument);
    if (imageDataUrls.length === 0) {
      skipped += 1;
      continue;
    }
    const imageFileIds = await uploadVisionFiles(options.client, options.batchDir, visionCheckpoint, doc, imageDataUrls);
    const customId = slugCustomId(options.phase, doc);
    const body = buildResponseBody({
      doc,
      markdown,
      imageFileIds,
      model: options.model,
      reasoning: options.reasoning,
      imageDetail: options.imageDetail,
      maxOutputTokens: options.maxOutputTokens,
    });
    jsonlLines.push(JSON.stringify({ custom_id: customId, method: "POST", url: "/v1/responses", body }));
    requests.push({
      customId,
      doc,
      ocrPath,
      captionPath: captionJsonPath(options.ocrDir, doc),
      auditPath: captionAuditJsonPath(options.ocrDir, doc),
      imageFileIds,
      imageCount: imageFileIds.length,
    });
  }

  const inputJsonlPath = path.join(options.batchDir, "input.jsonl");
  atomicWriteFile(inputJsonlPath, jsonlLines.join("\n") + (jsonlLines.length > 0 ? "\n" : ""));
  if (requests.length === 0) {
    throw new Error("No OCR image caption requests selected for batch");
  }
  const inputFileId = await uploadBatchInputFile(options.client, inputJsonlPath);
  const batch = await options.client.createBatch({
    inputFileId,
    endpoint: "/v1/responses",
    completionWindow: "24h",
  });
  const manifest: OcrCaptionBatchManifest = {
    schema_version: OCR_CAPTION_BATCH_SCHEMA_VERSION,
    phase: options.phase,
    model: options.model,
    reasoning: options.reasoning,
    imageDetail: options.imageDetail,
    maxOutputTokens: options.maxOutputTokens,
    endpoint: "/v1/responses",
    completionWindow: "24h",
    createdAt: new Date().toISOString(),
    batchDir: options.batchDir,
    inputJsonlPath,
    inputFileId,
    batchId: batch.id,
    status: batch.status,
    requestCount: requests.length,
    requests,
    outputFileId: batch.output_file_id ?? null,
    errorFileId: batch.error_file_id ?? null,
  };
  const manifestPath = path.join(options.batchDir, "manifest.json");
  atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { manifestPath, manifest, skipped };
}

function parseBatchOutputLine(line: string): {
  custom_id?: string;
  response?: { status_code?: number; body?: unknown };
  error?: { message?: string; code?: string } | null;
} {
  return JSON.parse(line) as {
    custom_id?: string;
    response?: { status_code?: number; body?: unknown };
    error?: { message?: string; code?: string } | null;
  };
}

function auditTrigger(phase: OcrCaptionBatchPhase, caption: ImageCaptionV2): string {
  const route = routeImageCaptionV2(caption).route;
  if (phase === "deep") {
    return "routing_deep_pass";
  }
  return route === "gpt-5.4" ? "routing_deep_pass_pending" : "nano_route";
}

export async function importOcrCaptionBatchResults(
  options: OcrCaptionBatchImportOptions,
): Promise<OcrCaptionBatchImportResult> {
  const manifest = readJsonFile<OcrCaptionBatchManifest>(options.manifestPath);
  const batch = await options.client.retrieveBatch(manifest.batchId);
  const outputFileId = batch.output_file_id ?? manifest.outputFileId;
  if (!outputFileId && !options.outputJsonlPath) {
    throw new Error("Batch has no output_file_id yet; status=" + batch.status);
  }
  const outputText = options.outputJsonlPath
    ? readFileSync(options.outputJsonlPath, "utf8")
    : await options.client.downloadFile(outputFileId!);
  const byCustomId = new Map(manifest.requests.map((request) => [request.customId, request]));
  let imported = 0;
  let failed = 0;
  let routedNano = 0;
  let routedDeep = 0;
  const errors: string[] = [];

  for (const line of outputText.split(/\r?\n/u).filter(Boolean)) {
    try {
      const parsed = parseBatchOutputLine(line);
      const request = parsed.custom_id ? byCustomId.get(parsed.custom_id) : undefined;
      if (!request) {
        failed += 1;
        errors.push("Unknown custom_id: " + String(parsed.custom_id));
        continue;
      }
      if (parsed.error) {
        failed += 1;
        errors.push(request.doc + ": " + (parsed.error.message ?? parsed.error.code ?? "batch error"));
        continue;
      }
      const statusCode = parsed.response?.status_code ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        failed += 1;
        errors.push(request.doc + ": response status " + String(statusCode));
        continue;
      }
      const responseText = extractResponseText(parsed.response?.body);
      const caption = normalizeImageCaptionV2(JSON.parse(responseText));
      const routing = routeImageCaptionV2(caption);
      if (routing.route === "gpt-5.4") {
        routedDeep += 1;
      } else {
        routedNano += 1;
      }
      atomicWriteFile(request.captionPath, JSON.stringify(caption, null, 2) + "\n");
      atomicWriteFile(
        request.auditPath,
        JSON.stringify(
          {
            doc: request.doc,
            phase: manifest.phase,
            batchId: manifest.batchId,
            customId: request.customId,
            selectedModel: manifest.model,
            route: routing.route,
            trigger: auditTrigger(manifest.phase, caption),
            routeReasons: routing.reasons,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
      );
      imported += 1;
    } catch (error) {
      failed += 1;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const updatedManifest: OcrCaptionBatchManifest = {
    ...manifest,
    status: batch.status,
    outputFileId: outputFileId ?? null,
    errorFileId: batch.error_file_id ?? manifest.errorFileId ?? null,
  };
  atomicWriteFile(options.manifestPath, JSON.stringify(updatedManifest, null, 2) + "\n");
  return {
    manifestPath: options.manifestPath,
    batchId: manifest.batchId,
    status: batch.status,
    imported,
    failed,
    routedNano,
    routedDeep,
    errors,
  };
}

export async function getOcrCaptionBatchStatus(input: {
  readonly manifestPath: string;
  readonly client: OcrCaptionBatchApiClient;
}): Promise<OcrCaptionBatchManifest> {
  const manifest = readJsonFile<OcrCaptionBatchManifest>(input.manifestPath);
  const batch = await input.client.retrieveBatch(manifest.batchId);
  const updated: OcrCaptionBatchManifest = {
    ...manifest,
    status: batch.status,
    outputFileId: batch.output_file_id ?? manifest.outputFileId ?? null,
    errorFileId: batch.error_file_id ?? manifest.errorFileId ?? null,
  };
  atomicWriteFile(input.manifestPath, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

export class OpenAIBatchApiClient implements OcrCaptionBatchApiClient {
  readonly apiKey: string;
  readonly endpoint: string;

  constructor(options: { readonly apiKey?: string; readonly endpoint?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.endpoint = options.endpoint ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OCR caption batch");
    }
  }

  async uploadFile(input: {
    readonly fileName: string;
    readonly contentType: string;
    readonly content: Uint8Array | string;
    readonly purpose: "vision" | "batch";
  }): Promise<string> {
    const form = new FormData();
    form.set("purpose", input.purpose);
    const content = typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
    form.set("file", new Blob([content], { type: input.contentType }), input.fileName);
    const response = await fetch(this.endpoint.replace(/\/$/u, "") + "/files", {
      method: "POST",
      headers: { authorization: "Bearer " + this.apiKey },
      body: form,
    });
    if (!response.ok) {
      throw new Error("OpenAI file upload failed: " + String(response.status) + " " + (await response.text()));
    }
    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error("OpenAI file upload did not return an id");
    }
    return payload.id;
  }

  async createBatch(input: {
    readonly inputFileId: string;
    readonly endpoint: "/v1/responses";
    readonly completionWindow: "24h";
  }): Promise<OcrCaptionBatchObject> {
    const response = await fetch(this.endpoint.replace(/\/$/u, "") + "/batches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        input_file_id: input.inputFileId,
        endpoint: input.endpoint,
        completion_window: input.completionWindow,
      }),
    });
    if (!response.ok) {
      throw new Error("OpenAI batch create failed: " + String(response.status) + " " + (await response.text()));
    }
    return (await response.json()) as OcrCaptionBatchObject;
  }

  async retrieveBatch(batchId: string): Promise<OcrCaptionBatchObject> {
    const response = await fetch(this.endpoint.replace(/\/$/u, "") + "/batches/" + encodeURIComponent(batchId), {
      headers: { authorization: "Bearer " + this.apiKey },
    });
    if (!response.ok) {
      throw new Error("OpenAI batch retrieve failed: " + String(response.status) + " " + (await response.text()));
    }
    return (await response.json()) as OcrCaptionBatchObject;
  }

  async downloadFile(fileId: string): Promise<string> {
    const response = await fetch(this.endpoint.replace(/\/$/u, "") + "/files/" + encodeURIComponent(fileId) + "/content", {
      headers: { authorization: "Bearer " + this.apiKey },
    });
    if (!response.ok) {
      throw new Error("OpenAI file download failed: " + String(response.status) + " " + (await response.text()));
    }
    return await response.text();
  }
}
