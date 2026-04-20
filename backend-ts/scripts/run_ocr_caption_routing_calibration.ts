import {
  getDefaultOcrCaptionRoutingCalibrationPaths,
  runOcrCaptionRoutingCalibration,
} from "../src/dataprep/ocr-caption-routing-calibration.ts";

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

const defaults = getDefaultOcrCaptionRoutingCalibrationPaths();
const result = await runOcrCaptionRoutingCalibration({
  ocrDir: envString("OCR_ROUTING_CALIBRATION_OCR_DIR") ?? defaults.ocrDir,
  outputDir: envString("OCR_ROUTING_CALIBRATION_OUTPUT_DIR") ?? defaults.outputDir,
  samplePath: envString("OCR_ROUTING_CALIBRATION_SAMPLE_PATH"),
  labelsPath: envString("OCR_ROUTING_CALIBRATION_LABELS_PATH"),
  reportPath: envString("OCR_ROUTING_CALIBRATION_REPORT_PATH") ?? defaults.reportPath,
  limit: envNumber("OCR_ROUTING_CALIBRATION_LIMIT", 30),
  imageDetail: envString("OCR_ROUTING_CALIBRATION_IMAGE_DETAIL") ?? envString("IMAGE_CAPTION_DETAIL") ?? "original",
  onProgress(event) {
    if (event.phase === "start") {
      process.stderr.write(
        "[" +
          String(event.sampleIndex) +
          "/" +
          String(event.sampleCount) +
          "] start " +
          event.model +
          " " +
          event.doc +
          "\n",
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

process.stdout.write(
  JSON.stringify(
    {
      model: result.model,
      sampleCount: result.sampleCount,
      decision: result.decision,
      metrics: result.metrics,
      outputDir: result.outputDir,
      samplesPath: result.samplesPath,
      resultsPath: result.resultsPath,
      reportPath: result.reportPath,
    },
    null,
    2,
  ) + "\n",
);
