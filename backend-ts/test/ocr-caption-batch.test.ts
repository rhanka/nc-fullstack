import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createOcrCaptionBatch,
  importOcrCaptionBatchResults,
  refreshOcrTechDocsAfterBatchImport,
  type OcrCaptionBatchApiClient,
} from "../src/dataprep/ocr-caption-batch.ts";

function buildRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-ocr-caption-batch-"));
}

function writeOcrPage(root: string, doc: string, markdown: string, image = true): void {
  const pagesDir = path.join(root, "pages");
  const ocrDir = path.join(root, "ocr");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(ocrDir, { recursive: true });
  writeFileSync(path.join(pagesDir, doc), "");
  writeFileSync(
    path.join(ocrDir, doc.replace(/\.pdf$/u, ".json")),
    JSON.stringify({
      pages: [
        {
          index: 0,
          markdown,
          images: image ? [{ id: "img-0.png", imageBase64: "data:image/png;base64,aGVsbG8=" }] : [],
        },
      ],
    }),
  );
}

function captionPayload(visualContentType: string): string {
  return JSON.stringify({
    schema_version: "a220_image_caption_v2",
    routing_profile_v1: {
      visual_content_type: visualContentType,
      domain_candidates: ["fuel"],
      rag_signal: {
        ocr_markdown_sufficient: false,
        visual_caption_adds_retrieval_terms: true,
        retrieval_terms: ["fuel flow", "collector tank"],
      },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: false,
        entity_candidates: [{ label: "Collector tank", type: "part", evidence: "visible label" }],
        relationship_candidates: [
          { source: "collector tank", relation: "feeds", target: "engine", evidence: "flow arrow" },
        ],
      },
      routing_evidence: ["flow arrow"],
    },
  });
}

class FakeBatchClient implements OcrCaptionBatchApiClient {
  uploaded: Array<{ fileName: string; purpose: string; content: string | Uint8Array }> = [];
  jsonl = "";
  failFirstVisionUpload = false;

  async uploadFile(input: {
    readonly fileName: string;
    readonly contentType: string;
    readonly content: Uint8Array | string;
    readonly purpose: "vision" | "batch";
  }): Promise<string> {
    if (this.failFirstVisionUpload && input.purpose === "vision") {
      this.failFirstVisionUpload = false;
      throw new Error("temporary timeout");
    }
    this.uploaded.push(input);
    if (input.purpose === "batch") {
      this.jsonl = Buffer.from(input.content).toString("utf8");
      return "file-batch";
    }
    return "file-vision-" + String(this.uploaded.filter((entry) => entry.purpose === "vision").length);
  }

  async createBatch(): Promise<{ id: string; status: string; input_file_id: string }> {
    return { id: "batch-123", status: "validating", input_file_id: "file-batch" };
  }

  async retrieveBatch(): Promise<{ id: string; status: string; output_file_id: string }> {
    return { id: "batch-123", status: "completed", output_file_id: "file-output" };
  }

  async downloadFile(): Promise<string> {
    return "";
  }
}

test("createOcrCaptionBatch uploads OCR images and creates a Responses JSONL batch", async () => {
  const root = buildRoot();
  writeOcrPage(root, "A220-door_page_0001.pdf", "# Door\n\n![img](img.png)");
  writeOcrPage(root, "A220-door_page_0002.pdf", "# Text only", false);
  const client = new FakeBatchClient();

  const result = await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir: path.join(root, "batch"),
    phase: "primary",
    mode: "missing",
    model: "gpt-5.4-nano",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client,
  });

  assert.equal(result.manifest.requestCount, 1);
  assert.equal(result.skipped, 1);
  assert.equal(client.uploaded.filter((entry) => entry.purpose === "vision").length, 1);
  assert.equal(client.uploaded.filter((entry) => entry.purpose === "batch").length, 1);
  const request = JSON.parse(client.jsonl.trim()) as {
    url?: string;
    body?: { model?: string; input?: Array<{ content?: Array<Record<string, unknown>> }> };
  };
  assert.equal(request.url, "/v1/responses");
  assert.equal(request.body?.model, "gpt-5.4-nano");
  assert.match(JSON.stringify(request.body), /file_id/u);
  assert.match(JSON.stringify(request.body), /OCR markdown context/u);
  assert.match(readFileSync(result.manifestPath, "utf8"), /batch-123/u);
});

test("createOcrCaptionBatch retries uploads and reuses checkpointed vision files", async () => {
  const root = buildRoot();
  writeOcrPage(root, "A220-door_page_0001.pdf", "# Door\n\n![img](img.png)");
  const batchDir = path.join(root, "batch");
  const firstClient = new FakeBatchClient();
  firstClient.failFirstVisionUpload = true;

  const first = await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir,
    phase: "primary",
    mode: "missing",
    model: "gpt-5.4-nano",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client: firstClient,
  });
  assert.equal(first.manifest.requestCount, 1);
  assert.equal(firstClient.uploaded.filter((entry) => entry.purpose === "vision").length, 1);

  const secondClient = new FakeBatchClient();
  await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir,
    phase: "primary",
    mode: "force",
    model: "gpt-5.4-nano",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client: secondClient,
  });

  assert.equal(secondClient.uploaded.filter((entry) => entry.purpose === "vision").length, 0);
  assert.equal(secondClient.uploaded.filter((entry) => entry.purpose === "batch").length, 1);
  assert.match(readFileSync(path.join(batchDir, "vision-files.json"), "utf8"), /file-vision-1/u);
});

test("importOcrCaptionBatchResults writes primary captions and marks deep candidates pending", async () => {
  const root = buildRoot();
  writeOcrPage(root, "A220-fuel_page_0001.pdf", "# Fuel flow\n\n![img](img.png)");
  const client = new FakeBatchClient();
  const created = await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir: path.join(root, "batch"),
    phase: "primary",
    mode: "force",
    model: "gpt-5.4-nano",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client,
  });
  const outputPath = path.join(root, "batch", "output.jsonl");
  writeFileSync(
    outputPath,
    JSON.stringify({
      custom_id: created.manifest.requests[0]?.customId,
      response: {
        status_code: 200,
        body: {
          output_text: captionPayload("flow_diagram"),
        },
      },
    }) + "\n",
  );

  const imported = await importOcrCaptionBatchResults({
    manifestPath: created.manifestPath,
    outputJsonlPath: outputPath,
    client,
  });

  assert.equal(imported.imported, 1);
  assert.equal(imported.routedDeep, 1);
  const audit = JSON.parse(
    readFileSync(path.join(root, "ocr", "A220-fuel_page_0001.image-caption.audit.json"), "utf8"),
  ) as { selectedModel?: string; route?: string; trigger?: string };
  assert.equal(audit.selectedModel, "gpt-5.4-nano");
  assert.equal(audit.route, "gpt-5.4");
  assert.equal(audit.trigger, "routing_deep_pass_pending");
});

test("createOcrCaptionBatch deep phase selects only pending deep-pass pages", async () => {
  const root = buildRoot();
  writeOcrPage(root, "A220-fuel_page_0001.pdf", "# Fuel flow\n\n![img](img.png)");
  writeOcrPage(root, "A220-door_page_0002.pdf", "# Door\n\n![img](img.png)");
  writeFileSync(
    path.join(root, "ocr", "A220-fuel_page_0001.image-caption.audit.json"),
    JSON.stringify({ route: "gpt-5.4", selectedModel: "gpt-5.4-nano" }),
  );
  writeFileSync(
    path.join(root, "ocr", "A220-door_page_0002.image-caption.audit.json"),
    JSON.stringify({ route: "nano", selectedModel: "gpt-5.4-nano" }),
  );
  const client = new FakeBatchClient();

  const result = await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir: path.join(root, "batch"),
    phase: "deep",
    mode: "missing",
    model: "gpt-5.4",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client,
  });

  assert.equal(result.manifest.requestCount, 1);
  assert.equal(result.manifest.requests[0]?.doc, "A220-fuel_page_0001.pdf");
  assert.match(client.jsonl, /gpt-5.4/u);
});

test("refreshOcrTechDocsAfterBatchImport rebuilds enriched OCR artifacts from imported caption sidecars", async () => {
  const root = buildRoot();
  writeOcrPage(root, "A220-fuel_page_0001.pdf", "# Fuel flow\n\n![img](img.png)");
  const client = new FakeBatchClient();
  const created = await createOcrCaptionBatch({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    batchDir: path.join(root, "batch"),
    phase: "primary",
    mode: "force",
    model: "gpt-5.4-nano",
    reasoning: "low",
    imageDetail: "original",
    maxOutputTokens: 6000,
    client,
  });
  const outputPath = path.join(root, "batch", "output.jsonl");
  writeFileSync(
    outputPath,
    JSON.stringify({
      custom_id: created.manifest.requests[0]?.customId,
      response: {
        status_code: 200,
        body: {
          output_text: captionPayload("flow_diagram"),
        },
      },
    }) + "\n",
  );
  await importOcrCaptionBatchResults({
    manifestPath: created.manifestPath,
    outputJsonlPath: outputPath,
    client,
  });

  const result = await refreshOcrTechDocsAfterBatchImport({
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed", "prepared.csv.gz"),
    auditFile: path.join(root, "managed", "prepared.audit.json"),
  });

  assert.equal(result.ocr.captionJsonWritten, 0);
  assert.equal(result.ocr.captionJsonSkipped, 1);
  assert.equal(result.csv.captionJsonRead, 1);
  assert.equal(result.csv.enrichedJsonWritten, 1);
  assert.equal(result.csv.enrichedMarkdownWritten, 1);
  assert.match(
    readFileSync(path.join(root, "ocr", "A220-fuel_page_0001__with_img_desc.md"), "utf8"),
    /Image description:/u,
  );
  assert.match(
    readFileSync(path.join(root, "managed", "prepared.audit.json"), "utf8"),
    /"captionJsonRead": 1/u,
  );
});
