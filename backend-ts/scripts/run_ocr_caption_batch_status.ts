import {
  OpenAIBatchApiClient,
  getOcrCaptionBatchStatus,
  latestOcrCaptionBatchManifest,
} from "../src/dataprep/ocr-caption-batch.ts";

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const manifestPath = envString("OCR_CAPTION_BATCH_MANIFEST") ?? latestOcrCaptionBatchManifest();
const manifest = await getOcrCaptionBatchStatus({
  manifestPath,
  client: new OpenAIBatchApiClient(),
});

process.stdout.write(JSON.stringify({ manifestPath, manifest }, null, 2) + "\n");
