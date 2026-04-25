import {
  createImageCaptionClientFromEnv,
  getDefaultOcrTechDocsPaths,
  runOcrTechDocsDataprep,
  type OcrTechDocsCaptionMode,
  type OcrTechDocsMode,
} from "../src/dataprep/ocr-tech-docs.ts";
import { createCascadeImageCaptionClientFromEnv } from "../src/dataprep/ocr-caption-cascade.ts";

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

function envBoolean(name: string): boolean {
  const value = envString(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function envMode(): OcrTechDocsMode {
  const value = envString("OCR_TECH_DOCS_MODE");
  if (!value || value === "existing" || value === "live") {
    return value ?? "existing";
  }
  throw new Error("OCR_TECH_DOCS_MODE must be existing or live");
}

function envCaptionMode(): OcrTechDocsCaptionMode {
  const value = envString("OCR_TECH_DOCS_CAPTIONS");
  if (!value || value === "off" || value === "missing" || value === "force") {
    return value ?? "off";
  }
  throw new Error("OCR_TECH_DOCS_CAPTIONS must be off, missing or force");
}

function useCascadeCaptionPolicy(): boolean {
  const value = (envString("OCR_TECH_DOCS_CAPTION_POLICY") ?? envString("IMAGE_CAPTION_POLICY") ?? "single").toLowerCase();
  if (value === "single" || value === "default") {
    return false;
  }
  if (value === "cascade") {
    return true;
  }
  throw new Error("IMAGE_CAPTION_POLICY must be single or cascade");
}

const defaults = getDefaultOcrTechDocsPaths();
const imageCaptionClientFactory = useCascadeCaptionPolicy()
  ? createCascadeImageCaptionClientFromEnv
  : createImageCaptionClientFromEnv;
const result = await runOcrTechDocsDataprep({
  ...defaults,
  pagesDir: envString("OCR_TECH_DOCS_PAGES_DIR") ?? defaults.pagesDir,
  ocrDir: envString("OCR_TECH_DOCS_OCR_DIR") ?? defaults.ocrDir,
  outputFile: envString("OCR_TECH_DOCS_OUTPUT_FILE") ?? defaults.outputFile,
  auditFile: envString("OCR_TECH_DOCS_AUDIT_FILE") ?? defaults.auditFile,
  mode: envMode(),
  captionMode: envCaptionMode(),
  imageCaptionClientFactory,
  captionConcurrency: envNumber("OCR_TECH_DOCS_CAPTION_CONCURRENCY"),
  limit: envNumber("OCR_TECH_DOCS_LIMIT"),
  forceOcr: envBoolean("OCR_TECH_DOCS_FORCE"),
  mistralModel: envString("MISTRAL_OCR_MODEL"),
});

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
