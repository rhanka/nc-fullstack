import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateKnowledgePublicArtifacts } from "../src/dataprep/knowledge-public-artifacts.ts";

function buildRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-knowledge-public-artifacts-"));
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeValidCorpus(outputRoot: string): void {
  writeJson(path.join(outputRoot, "ontology", "images.json"), [
    {
      id: "door-image-1",
      doc: "door-page-001.pdf",
      asset_path: "wiki/images/door-image-1.png",
    },
  ]);
  writeJson(path.join(outputRoot, "ontology", "image_relations.json"), [
    {
      from: "part:door",
      relation: "illustrated_by",
      to: "image:door-image-1",
      doc: "door-page-001.pdf",
      score: 9,
      reasons: ["caption_candidate"],
    },
  ]);
  writeJson(path.join(outputRoot, "wiki", "index.json"), [
    {
      slug: "door",
      title: "Door",
      path: "parts/door.md",
      linked_images: [
        {
          id: "door-image-1",
          doc: "door-page-001.pdf",
          asset_path: "images/door-image-1.png",
        },
      ],
    },
  ]);
  mkdirSync(path.join(outputRoot, "wiki", "images"), { recursive: true });
  mkdirSync(path.join(outputRoot, "wiki", "parts"), { recursive: true });
  writeFileSync(path.join(outputRoot, "wiki", "images", "door-image-1.png"), Buffer.from("png"));
  writeFileSync(path.join(outputRoot, "wiki", "parts", "door.md"), "# Door\n", "utf8");
}

test("validateKnowledgePublicArtifacts accepts public wiki image artifacts", () => {
  const outputRoot = buildRoot();
  writeValidCorpus(outputRoot);

  const report = validateKnowledgePublicArtifacts({
    corpora: [{ corpus: "tech_docs", outputRoot }],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.corpora[0]?.imageCount, 1);
  assert.equal(report.corpora[0]?.linkedImageCount, 1);
});

test("validateKnowledgePublicArtifacts rejects broken linked image assets", () => {
  const outputRoot = buildRoot();
  writeValidCorpus(outputRoot);
  writeJson(path.join(outputRoot, "wiki", "index.json"), [
    {
      slug: "door",
      title: "Door",
      path: "parts/door.md",
      linked_images: [{ id: "missing-image", asset_path: "images/missing-image.png" }],
    },
  ]);

  const report = validateKnowledgePublicArtifacts({
    corpora: [{ corpus: "tech_docs", outputRoot }],
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("missing linked image asset")));
});
