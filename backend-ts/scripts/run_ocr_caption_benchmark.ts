import {
  getDefaultOcrCaptionBenchmarkPaths,
  parseBenchmarkModels,
  runOcrCaptionBenchmark,
} from "../src/dataprep/ocr-caption-benchmark.ts";

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = envString(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaults = getDefaultOcrCaptionBenchmarkPaths();
const result = await runOcrCaptionBenchmark({
  ocrDir: envString("OCR_CAPTION_BENCHMARK_OCR_DIR") ?? defaults.ocrDir,
  outputDir: envString("OCR_CAPTION_BENCHMARK_OUTPUT_DIR") ?? defaults.outputDir,
  models: parseBenchmarkModels(envString("OCR_CAPTION_BENCHMARK_MODELS")),
  limit: envNumber("OCR_CAPTION_BENCHMARK_LIMIT", 30),
  imageDetail: envString("OCR_CAPTION_BENCHMARK_IMAGE_DETAIL") ?? envString("IMAGE_CAPTION_DETAIL") ?? "original",
  onProgress(event) {
    if (event.phase === "start") {
      process.stderr.write(
        "[" + String(event.sampleIndex) + "/" + String(event.sampleCount) + "] start " + event.model + " " + event.doc + "\n",
      );
      return;
    }
    const seconds = event.durationMs === undefined ? "?" : (event.durationMs / 1000).toFixed(1) + "s";
    if (event.phase === "ok") {
      process.stderr.write(
        "[" + String(event.sampleIndex) + "/" + String(event.sampleCount) + "] ok " + event.model + " " + seconds + "\n",
      );
      return;
    }
    process.stderr.write(
      "[" +
        String(event.sampleIndex) +
        "/" +
        String(event.sampleCount) +
        "] error " +
        event.model +
        " " +
        seconds +
        ": " +
        String(event.error ?? "unknown error").slice(0, 240) +
        "\n",
    );
  },
});

process.stdout.write(JSON.stringify({
  models: result.models,
  sampleCount: result.sampleCount,
  outputDir: result.outputDir,
  samplesPath: result.samplesPath,
  resultsPath: result.resultsPath,
  reportPath: result.reportPath,
}, null, 2) + "\n");
