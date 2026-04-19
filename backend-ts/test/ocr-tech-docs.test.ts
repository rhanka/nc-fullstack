import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyPageRetrievalPolicy,
  buildPageMarkdownWithImageDescriptions,
  buildPreparedTechDocsCsvFromOcrArtifacts,
  normalizeImageCaptionAnalysis,
  type ImageCaptionAnalysis,
} from "../src/dataprep/ocr-tech-docs.ts";

function buildTestRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-ocr-tech-docs-"));
}

function readGzipText(filePath: string): string {
  return gunzipSync(readFileSync(filePath)).toString("utf8");
}

test("applyPageRetrievalPolicy excludes high-confidence cover pages", () => {
  const analysis = normalizeImageCaptionAnalysis({
    schema_version: "a220_image_caption_v1",
    page_category: "cover_page",
    page_category_confidence: 0.92,
    retrieval_action: "index",
    retrieval_weight: 1,
    short_summary: "Manual cover.",
    technical_description: "Cover page for the C Series manual.",
  });

  const policy = applyPageRetrievalPolicy(analysis);

  assert.equal(policy.action, "exclude");
  assert.equal(policy.weight, 0);
});

test("buildPageMarkdownWithImageDescriptions replaces OCR image placeholders with technical captions", () => {
  const markdown = [
    "# Door structure",
    "",
    "The following figure shows the door.",
    "",
    "![img-0.jpeg](img-0.jpeg)",
  ].join("\n");
  const analysis: ImageCaptionAnalysis = normalizeImageCaptionAnalysis({
    schema_version: "a220_image_caption_v1",
    page_category: "technical_diagram",
    page_category_confidence: 0.87,
    retrieval_action: "index",
    retrieval_weight: 1,
    short_summary: "A220 door frame diagram.",
    technical_description:
      "Diagram of the passenger door frame, hinge fittings, latch area, and surrounding fuselage structure.",
    visible_text: ["Door frame"],
  });

  const enriched = buildPageMarkdownWithImageDescriptions(markdown, [analysis]);

  assert.match(enriched, /Image description: Diagram of the passenger door frame/u);
  assert.doesNotMatch(enriched, /!\[img-0\.jpeg\]/u);
});

test("buildPreparedTechDocsCsvFromOcrArtifacts emits compatible rows and excludes non-content pages", async () => {
  const root = buildTestRoot();
  const pagesDir = path.join(root, "pages");
  const ocrDir = path.join(root, "ocr");
  const outputFile = path.join(root, "managed_dataset", "a220_tech_docs_content_prepared.csv.gz");
  const auditFile = path.join(root, "managed_dataset", "a220_tech_docs_content_prepared.audit.json");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(ocrDir, { recursive: true });

  writeFileSync(path.join(pagesDir, "A220-door_page_0001.pdf"), "");
  writeFileSync(path.join(pagesDir, "A220-door_page_0002.pdf"), "");
  writeFileSync(
    path.join(ocrDir, "A220-door_page_0001.json"),
    JSON.stringify({
      pages: [
        {
          index: 0,
          markdown: "# A220 Passenger Door\n\n![img-0.jpeg](img-0.jpeg)\n\nATA 52 door inspection near frame 20/21.",
          images: [{ id: "img-0.jpeg", imageBase64: "data:image/png;base64,aGVsbG8=" }],
        },
      ],
    }),
  );
  writeFileSync(
    path.join(ocrDir, "A220-door_page_0001.image-caption.json"),
    JSON.stringify({
      schema_version: "a220_image_caption_v1",
      page_category: "technical_diagram",
      page_category_confidence: 0.9,
      retrieval_action: "index",
      retrieval_weight: 1,
      short_summary: "Door frame diagram.",
      technical_description: "Detailed schematic of the A220 passenger door frame and latch fittings.",
      visible_text: ["ATA 52"],
      ata_candidates: ["ATA 52"],
      part_or_zone_candidates: ["Passenger Door", "Frame 20/21"],
    }),
  );
  writeFileSync(
    path.join(ocrDir, "A220-door_page_0002.json"),
    JSON.stringify({
      pages: [
        {
          index: 0,
          markdown: "# A220 Manual Cover\n\nAirbus training manual cover.",
          images: [],
        },
      ],
    }),
  );
  writeFileSync(
    path.join(ocrDir, "A220-door_page_0002.image-caption.json"),
    JSON.stringify({
      schema_version: "a220_image_caption_v1",
      page_category: "cover_page",
      page_category_confidence: 0.95,
      retrieval_action: "index",
      retrieval_weight: 1,
      short_summary: "Cover page.",
      technical_description: "Cover page for the A220 manual.",
    }),
  );

  const result = await buildPreparedTechDocsCsvFromOcrArtifacts({
    pagesDir,
    ocrDir,
    outputFile,
    auditFile,
    chunkMaxChars: 400,
  });

  assert.equal(result.pagesDiscovered, 2);
  assert.equal(result.pagesIndexed, 1);
  assert.equal(result.pagesExcluded, 1);
  assert.equal(result.rowsWritten, 1);
  assert.equal(result.enrichedJsonWritten, 1);
  assert.equal(result.enrichedMarkdownWritten, 1);

  const enrichedJson = JSON.parse(readFileSync(path.join(ocrDir, "A220-door_page_0001__with_img_desc.json"), "utf8")) as {
    pages?: Array<{ markdown_alt?: string }>;
  };
  assert.match(enrichedJson.pages?.[0]?.markdown_alt ?? "", /Detailed schematic of the A220 passenger door frame/u);
  assert.match(
    readFileSync(path.join(ocrDir, "A220-door_page_0001__with_img_desc.md"), "utf8"),
    /Detailed schematic of the A220 passenger door frame/u,
  );

  const csv = readGzipText(outputFile);
  assert.match(csv, /^doc\tdoc_root\tjson_data\tchunk\tlength\tchunk_id\tata\tparts\tdoc_type\n/u);
  assert.match(csv, /A220-door_page_0001\.pdf/u);
  assert.match(csv, /Detailed schematic of the A220 passenger door frame/u);
  assert.doesNotMatch(csv, /A220-door_page_0002\.pdf/u);

  const audit = JSON.parse(readFileSync(auditFile, "utf8")) as typeof result;
  assert.equal(audit.rowsWritten, 1);
  assert.equal(audit.pagesExcluded, 1);
});
