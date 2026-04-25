import {
  OpenAIBatchApiClient,
  importOcrCaptionBatchResults,
  latestOcrCaptionBatchManifest,
} from "../src/dataprep/ocr-caption-batch.ts";

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const manifestPath = envString("OCR_CAPTION_BATCH_MANIFEST") ?? latestOcrCaptionBatchManifest();
const result = await importOcrCaptionBatchResults({
  manifestPath,
  outputJsonlPath: envString("OCR_CAPTION_BATCH_OUTPUT_JSONL"),
  client: new OpenAIBatchApiClient(),
});

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
