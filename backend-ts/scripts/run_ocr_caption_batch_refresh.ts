import {
  refreshOcrTechDocsAfterBatchImport,
} from "../src/dataprep/ocr-caption-batch.ts";
import { getDefaultOcrTechDocsPaths } from "../src/dataprep/ocr-tech-docs.ts";

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

const defaults = getDefaultOcrTechDocsPaths();
const result = await refreshOcrTechDocsAfterBatchImport({
  pagesDir: envString("OCR_TECH_DOCS_PAGES_DIR") ?? defaults.pagesDir,
  ocrDir: envString("OCR_TECH_DOCS_OCR_DIR") ?? defaults.ocrDir,
  outputFile: envString("OCR_TECH_DOCS_OUTPUT_FILE") ?? defaults.outputFile,
  auditFile: envString("OCR_TECH_DOCS_AUDIT_FILE") ?? defaults.auditFile,
  limit: envNumber("OCR_CAPTION_BATCH_LIMIT"),
});

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
