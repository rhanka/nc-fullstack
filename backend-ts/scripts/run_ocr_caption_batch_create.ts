import {
  OpenAIBatchApiClient,
  createOcrCaptionBatch,
  defaultOcrCaptionBatchDir,
  type OcrCaptionBatchMode,
  type OcrCaptionBatchPhase,
} from "../src/dataprep/ocr-caption-batch.ts";
import { getDefaultOcrTechDocsPaths, type ImageCaptionReasoning } from "../src/dataprep/ocr-tech-docs.ts";

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envNumber(name: string): number | undefined {
  const value = envString(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function envPhase(): OcrCaptionBatchPhase {
  const value = envString("OCR_CAPTION_BATCH_PHASE");
  if (!value || value === "primary" || value === "deep") {
    return value ?? "primary";
  }
  throw new Error("OCR_CAPTION_BATCH_PHASE must be primary or deep");
}

function envMode(): OcrCaptionBatchMode {
  const value = envString("OCR_CAPTION_BATCH_MODE");
  if (!value || value === "missing" || value === "force") {
    return value ?? "missing";
  }
  throw new Error("OCR_CAPTION_BATCH_MODE must be missing or force");
}

const phase = envPhase();
const defaults = getDefaultOcrTechDocsPaths();
const result = await createOcrCaptionBatch({
  ...defaults,
  pagesDir: envString("OCR_TECH_DOCS_PAGES_DIR") ?? defaults.pagesDir,
  ocrDir: envString("OCR_TECH_DOCS_OCR_DIR") ?? defaults.ocrDir,
  outputFile: envString("OCR_TECH_DOCS_OUTPUT_FILE") ?? defaults.outputFile,
  auditFile: envString("OCR_TECH_DOCS_AUDIT_FILE") ?? defaults.auditFile,
  batchDir: envString("OCR_CAPTION_BATCH_DIR") ?? defaultOcrCaptionBatchDir(phase),
  phase,
  mode: envMode(),
  model:
    envString("OCR_CAPTION_BATCH_MODEL") ??
    (phase === "primary"
      ? envString("IMAGE_CAPTION_PRIMARY_MODEL") ?? "gpt-5.4-nano"
      : envString("IMAGE_CAPTION_DEEP_MODEL") ?? "gpt-5.4"),
  reasoning: (envString("OCR_CAPTION_BATCH_REASONING") ??
    envString("OCR_ROUTING_CALIBRATION_REASONING") ??
    "low") as ImageCaptionReasoning,
  imageDetail: envString("OCR_CAPTION_BATCH_IMAGE_DETAIL") ?? envString("IMAGE_CAPTION_DETAIL") ?? "original",
  maxOutputTokens: envNumber("OCR_CAPTION_BATCH_MAX_OUTPUT_TOKENS") ?? envNumber("IMAGE_CAPTION_MAX_OUTPUT_TOKENS") ?? 6000,
  limit: envNumber("OCR_CAPTION_BATCH_LIMIT"),
  client: new OpenAIBatchApiClient(),
});

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
