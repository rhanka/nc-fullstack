import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listOcrCaptionBenchmarkCandidates,
  parseBenchmarkModels,
  runOcrCaptionBenchmark,
  selectOcrCaptionBenchmarkSamples,
  type OcrCaptionBenchmarkSample,
} from "../src/dataprep/ocr-caption-benchmark.ts";
import { normalizeImageCaptionAnalysis, type ImageCaptionClient } from "../src/dataprep/ocr-tech-docs.ts";

function buildRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-ocr-caption-benchmark-"));
}

function writeOcrPage(ocrDir: string, name: string, markdown: string, images: readonly string[]): void {
  writeFileSync(
    path.join(ocrDir, name + ".json"),
    JSON.stringify({
      pages: [
        {
          index: 0,
          markdown,
          images: images.map((imageBase64, index) => ({ id: "img-" + String(index) + ".jpeg", imageBase64 })),
        },
      ],
    }),
  );
}

function mockClient(model: string): ImageCaptionClient {
  return {
    provider: "mock",
    model,
    async analyzePage(input) {
      return normalizeImageCaptionAnalysis({
        schema_version: "a220_image_caption_v1",
        page_category: "technical_diagram",
        page_category_confidence: model.includes("nano") ? 0.7 : 0.9,
        retrieval_action: "index",
        retrieval_weight: 1,
        short_summary: model + " caption for " + input.doc,
        technical_description: model + " described " + String(input.imageDataUrls.length) + " image(s).",
        visible_text: ["ATA 52"],
        ata_candidates: ["ATA 52"],
      });
    },
  };
}

test("listOcrCaptionBenchmarkCandidates reads only OCR pages with extracted images", () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  mkdirSync(ocrDir, { recursive: true });
  writeOcrPage(ocrDir, "A-small_page_0001", "# Small\n\n![img](img.jpeg)", ["aGVsbG8="]);
  writeOcrPage(ocrDir, "B-empty_page_0002", "# Empty", []);
  writeFileSync(path.join(ocrDir, "C-existing_page_0003.image-caption.json"), "{}");

  const candidates = listOcrCaptionBenchmarkCandidates(ocrDir);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.doc, "A-small_page_0001.pdf");
  assert.equal(candidates[0]?.imageCount, 1);
  assert.match(candidates[0]?.imageDataUrls[0] ?? "", /^data:image\/jpeg;base64,/u);
});

test("selectOcrCaptionBenchmarkSamples is deterministic and preserves strata diversity", () => {
  const candidates: OcrCaptionBenchmarkSample[] = [
    sample("a.pdf", "small", 1, 10_000),
    sample("b.pdf", "small", 1, 20_000),
    sample("c.pdf", "medium", 1, 90_000),
    sample("d.pdf", "large", 1, 250_000),
    sample("e.pdf", "multi", 3, 250_000),
    sample("f.pdf", "multi", 2, 300_000),
  ];

  const selected = selectOcrCaptionBenchmarkSamples(candidates, 4);

  assert.deepEqual(
    selected.map((entry) => entry.stratum).sort(),
    ["large", "medium", "multi", "small"],
  );
  assert.deepEqual(
    selected.map((entry) => entry.doc),
    ["a.pdf", "c.pdf", "d.pdf", "e.pdf"],
  );
});

function sample(
  doc: string,
  stratum: OcrCaptionBenchmarkSample["stratum"],
  imageCount: number,
  approxImageBytes: number,
): OcrCaptionBenchmarkSample {
  return {
    doc,
    ocrPath: "/tmp/" + doc.replace(/\.pdf$/u, ".json"),
    markdown: "# " + doc,
    imageDataUrls: Array.from({ length: imageCount }, () => "data:image/jpeg;base64,aGVsbG8="),
    imageCount,
    approxImageBytes,
    stratum,
  };
}

test("runOcrCaptionBenchmark writes side-by-side model results without live network", async () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  const outputDir = path.join(root, "benchmark");
  mkdirSync(ocrDir, { recursive: true });
  writeOcrPage(ocrDir, "A-door_page_0001", "# Door\n\n![img](img.jpeg)\nATA 52", ["aGVsbG8="]);

  const result = await runOcrCaptionBenchmark({
    ocrDir,
    outputDir,
    models: ["gpt-5.4-nano", "gpt-5.4"],
    limit: 1,
    clientFactory: mockClient,
  });

  assert.equal(result.sampleCount, 1);
  assert.equal(result.results[0]?.results.length, 2);
  assert.deepEqual(result.results[0]?.results.map((entry) => entry.status), ["ok", "ok"]);
  assert.ok(existsSync(result.samplesPath));
  assert.ok(existsSync(result.resultsPath));
  assert.ok(existsSync(result.reportPath));
  assert.match(readFileSync(result.reportPath, "utf8"), /gpt-5\.4-nano, gpt-5\.4/u);
});

test("runOcrCaptionBenchmark records per-model failures and keeps the batch alive", async () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  const outputDir = path.join(root, "benchmark");
  mkdirSync(ocrDir, { recursive: true });
  writeOcrPage(ocrDir, "A-door_page_0001", "# Door\n\n![img](img.jpeg)\nATA 52", ["aGVsbG8="]);

  const events: string[] = [];
  const result = await runOcrCaptionBenchmark({
    ocrDir,
    outputDir,
    models: ["gpt-5.4-nano", "broken-model"],
    limit: 1,
    clientFactory(model) {
      if (model === "broken-model") {
        return {
          provider: "mock",
          model,
          async analyzePage() {
            throw new SyntaxError("unterminated model JSON");
          },
        };
      }
      return mockClient(model);
    },
    onProgress(event) {
      events.push(event.phase + ":" + event.model);
    },
  });

  const runs = result.results[0]?.results ?? [];
  assert.deepEqual(runs.map((entry) => entry.status), ["ok", "error"]);
  assert.ok(existsSync(runs[0]?.outputPath ?? ""));
  assert.ok(existsSync(runs[1]?.outputPath ?? ""));
  assert.match(readFileSync(result.reportPath, "utf8"), /broken-model: unterminated model JSON/u);
  assert.deepEqual(events, [
    "start:gpt-5.4-nano",
    "ok:gpt-5.4-nano",
    "start:broken-model",
    "error:broken-model",
  ]);
});

test("runOcrCaptionBenchmark resumes from existing per-model result files", async () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  const outputDir = path.join(root, "benchmark");
  mkdirSync(ocrDir, { recursive: true });
  mkdirSync(path.join(outputDir, "results"), { recursive: true });
  writeOcrPage(ocrDir, "A-door_page_0001", "# Door\n\n![img](img.jpeg)\nATA 52", ["aGVsbG8="]);
  writeFileSync(
    path.join(outputDir, "results", "a-door-page-0001-pdf.gpt-5-4-nano.json"),
    JSON.stringify({
      model: "gpt-5.4-nano",
      provider: "mock",
      status: "ok",
      durationMs: 123,
      analysis: {
        schema_version: "a220_image_caption_v1",
        page_category: "technical_diagram",
        short_summary: "Cached caption.",
        technical_description: "Cached technical caption.",
      },
    }),
  );

  const result = await runOcrCaptionBenchmark({
    ocrDir,
    outputDir,
    models: ["gpt-5.4-nano"],
    limit: 1,
    clientFactory(model) {
      return {
        provider: "mock",
        model,
        async analyzePage() {
          throw new Error("live client should not be called for cached result");
        },
      };
    },
  });

  const run = result.results[0]?.results[0];
  assert.equal(run?.status, "ok");
  assert.equal(run?.durationMs, 123);
});

test("parseBenchmarkModels trims and deduplicates model names", () => {
  assert.deepEqual(parseBenchmarkModels(" gpt-5.4-nano, gpt-5.4, gpt-5.4-nano "), ["gpt-5.4-nano", "gpt-5.4"]);
});
