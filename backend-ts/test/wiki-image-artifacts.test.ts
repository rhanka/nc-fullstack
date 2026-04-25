import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPublicWikiImageArtifacts,
  type WikiImagePart,
} from "../src/dataprep/wiki-image-artifacts.ts";
import type { PreparedRecord } from "../src/dataprep/pipeline.ts";

function buildRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-wiki-image-artifacts-"));
}

test("buildPublicWikiImageArtifacts skips chapter separator pages even with stale technical captions", () => {
  const root = buildRoot();
  const outputRoot = root;
  const ontologyRoot = path.join(root, "ontology");
  const ocrDir = path.join(outputRoot, "ocr");
  mkdirSync(ocrDir, { recursive: true });
  mkdirSync(ontologyRoot, { recursive: true });

  writeFileSync(
    path.join(ocrDir, "ATA-30_page_0001.json"),
    JSON.stringify({
      pages: [
        {
          index: 0,
          dimensions: { width: 2200, height: 1700, dpi: 200 },
          markdown: "# ATA 30 - Ice And Rain Protection\n\n![img-0.jpeg](img-0.jpeg)",
          images: [
            {
              id: "img-0.jpeg",
              top_left_x: 0,
              top_left_y: 380,
              bottom_right_x: 2200,
              bottom_right_y: 1690,
              image_base64: "aGVsbG8=",
            },
          ],
        },
      ],
    }),
  );
  writeFileSync(
    path.join(ocrDir, "ATA-30_page_0001.image-caption.json"),
    JSON.stringify({
      schema_version: "a220_image_caption_v1",
      page_category: "technical_photo",
      page_category_confidence: 0.94,
      retrieval_action: "index",
      retrieval_weight: 1,
      short_summary: "CS100 aircraft photo.",
      technical_description: "Marketing-style aircraft image.",
      visible_identifiers: ["BD-500-1A10"],
      part_or_zone_candidates: ["Aircraft"],
    }),
  );

  const records: PreparedRecord[] = [
    {
      corpus: "tech_docs",
      doc: "ATA-30_page_0001.pdf",
      chunk_id: "ATA-30_page_0001.pdf 0",
      content: "ATA 30 separator",
      source_path: "managed_dataset/a220_tech_docs_content_prepared.csv.gz",
      metadata: {
        doc_root: "ATA-30.pdf",
      },
    },
  ];
  const parts: WikiImagePart[] = [
    {
      slug: "aircraft",
      canonical_name: "Aircraft",
      aliases: ["CS100"],
      supporting_docs: ["ATA-30_page_0001.pdf"],
    },
  ];

  buildPublicWikiImageArtifacts({
    outputRoot,
    ontologyRoot,
    records,
    parts,
  });

  const images = JSON.parse(readFileSync(path.join(ontologyRoot, "images.json"), "utf8")) as unknown[];
  const relations = JSON.parse(readFileSync(path.join(ontologyRoot, "image_relations.json"), "utf8")) as unknown[];
  assert.deepEqual(images, []);
  assert.deepEqual(relations, []);
});
