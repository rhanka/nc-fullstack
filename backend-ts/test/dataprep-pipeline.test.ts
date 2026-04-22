import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  normalizeNcPreparedRow,
  normalizeTechDocsPreparedRow,
  parseDelimitedTable,
  runDataprepForCorpus,
  runKnowledgeDataprepForCorpus,
  type DataprepCorpusConfig,
  type EmbeddingProvider,
  type PartCanonicalizer,
  type PartCanonicalizerInput,
} from "../src/dataprep/pipeline.ts";

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fake-embedding-model";

  async embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]> {
    return inputs.map((input) => {
      const chars = Array.from(input);
      const a = chars.reduce((sum, char) => sum + char.charCodeAt(0), 0) % 97;
      const b = chars.reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0) % 101;
      const c = chars.length % 89;
      return [a / 100, b / 100, c / 100];
    });
  }
}

class FakePartCanonicalizer implements PartCanonicalizer {
  readonly model = "fake-canonicalizer";

  async canonicalize(input: PartCanonicalizerInput) {
    return {
      canonicalName: input.seedName.replace(/\bRH\b/u, "Right-hand"),
      aliases: input.aliases,
      shortDescription: `Canonicalized part for ${input.seedName}.`,
    };
  }
}

function encodeField(value: string): string {
  if (/["\t\r\n\\]/u.test(value)) {
    return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
  }
  return value;
}

function writeGzipTsv(filePath: string, rows: readonly (readonly string[])[]): void {
  const text = rows.map((row) => row.map((value) => encodeField(value)).join("\t")).join("\n");
  writeFileSync(filePath, gzipSync(`${text}\n`));
}

function buildTestRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-dataprep-"));
}

test("parseDelimitedTable preserves multiline quoted TSV fields", () => {
  const rows = parseDelimitedTable('a\t"line 1\nline 2"\tb\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ["a", "line 1\nline 2", "b"]);
});

test("runDataprepForCorpus builds retrieval and knowledge artifacts from prepared corpora", async () => {
  const root = buildTestRoot();

  const techSource = path.join(root, "tech_docs.csv.gz");
  const ncSource = path.join(root, "nc.csv.gz");
  const techOutputRoot = path.join(root, "tech");
  const ncOutputRoot = path.join(root, "nc");
  mkdirSync(techOutputRoot, { recursive: true });
  mkdirSync(ncOutputRoot, { recursive: true });

  writeGzipTsv(techSource, [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
    [
      "A220-ATA52-door-page_0001.pdf",
      "A220-ATA52-door.pdf",
      "A220-ATA52-door-page_0001.json",
      "# RH Passenger Door\nInspection of RH passenger door near frame 20/21 in the right forward fuselage zone.",
      "102",
      "A220-ATA52-door-page_0001.pdf 0",
      "ATA 52",
      "RH Passenger Door; Door Frame 20/21",
      "procedure",
    ],
    [
      "A220-ATA52-door-page_0002.pdf",
      "A220-ATA52-door.pdf",
      "A220-ATA52-door-page_0002.json",
      "Door frame 20/21 repair limits and RH installation references for ATA 52.",
      "76",
      "A220-ATA52-door-page_0002.pdf 0",
      "ATA 52",
      "Door Frame 20/21",
      "procedure",
    ],
  ]);

  writeGzipTsv(ncSource, [
    [
      "ATA-52-demo-event",
      "ATA-52-demo-event-000-2026-04-14T12:00:00.000Z",
      "##ATA 52 - 000\nObservation on RH passenger door near frame 20/21.\nRelated parts: A220-52-1001, A220-52-2002.",
    ],
    [
      "ATA-52-demo-event",
      "ATA-52-demo-event-100-2026-04-14T13:00:00.000Z",
      "##ATA 52 - 100\nAnalysis of right forward fuselage door surround discrepancy.",
    ],
  ]);

  const techConfig: DataprepCorpusConfig = {
    corpus: "tech_docs",
    sourceFile: techSource,
    outputRoot: techOutputRoot,
    hasHeader: true,
    normalizeRow: normalizeTechDocsPreparedRow,
  };
  const ncConfig: DataprepCorpusConfig = {
    corpus: "non_conformities",
    sourceFile: ncSource,
    outputRoot: ncOutputRoot,
    hasHeader: false,
    normalizeRow: normalizeNcPreparedRow,
  };

  const options = {
    embeddingProvider: new FakeEmbeddingProvider(),
    partCanonicalizer: new FakePartCanonicalizer(),
    llmAssistMode: "part_canonicalization" as const,
    embeddingBatchSize: 2,
  };

  const techResult = await runDataprepForCorpus(techConfig, options);
  const ncResult = await runDataprepForCorpus(ncConfig, options);

  assert.equal(techResult.recordCount, 2);
  assert.equal(techResult.vectorExport.count, 2);
  assert.equal(techResult.vectorExport.dimensions, 3);
  assert.equal(techResult.lexical.documentCount, 2);
  assert.ok(techResult.ontology.partCount >= 2);
  assert.ok(techResult.wiki.pageCount >= 2);

  const techManifest = JSON.parse(readFileSync(techResult.knowledgeManifestPath, "utf8")) as Record<string, unknown>;
  assert.equal(techManifest.corpus, "tech_docs");
  assert.equal(techManifest.embeddingModel, "fake-embedding-model");

  const techParts = JSON.parse(
    readFileSync(path.join(techResult.ontology.root, "parts.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  assert.ok(techParts.some((part) => String(part.canonical_name).includes("Passenger Door")));

  const techWikiIndex = JSON.parse(readFileSync(techResult.wiki.indexPath, "utf8")) as Array<Record<string, unknown>>;
  assert.ok(techWikiIndex.some((entry) => String(entry.path).endsWith(".md")));
  assert.ok(techWikiIndex.some((entry) => entry.entity_type === "part"));
  assert.ok(techWikiIndex.some((entry) => typeof entry.short_description === "string" && entry.short_description.length > 0));
  assert.ok(techWikiIndex.some((entry) => Array.isArray(entry.supporting_docs) && entry.supporting_docs.length > 0));
  const firstWikiPath = path.join(techResult.wiki.root, String(techWikiIndex[0]?.path ?? ""));
  assert.match(readFileSync(firstWikiPath, "utf8"), /Technical documents/u);

  const techDb = new DatabaseSync(techResult.lexical.dbPath);
  const techRow = techDb.prepare("SELECT COUNT(*) AS count FROM lexical_documents").get() as { count: number };
  techDb.close();
  assert.equal(techRow.count, 2);

  assert.equal(ncResult.recordCount, 2);
  assert.equal(ncResult.vectorExport.count, 2);
  assert.equal(ncResult.lexical.documentCount, 2);
  assert.equal(ncResult.ontology.occurrenceCount, 2);
  assert.equal(ncResult.wiki.pageCount, 0);

  const ncOccurrences = JSON.parse(
    readFileSync(path.join(ncResult.ontology.root, "occurrences.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  assert.equal(ncOccurrences[0]?.task_kind, "000");
  assert.ok(Array.isArray(ncOccurrences[0]?.part_numbers));
});

test("runKnowledgeDataprepForCorpus builds ontology and wiki without embeddings", async () => {
  const root = buildTestRoot();
  const techSource = path.join(root, "tech_docs.csv.gz");
  const techOutputRoot = path.join(root, "tech");
  mkdirSync(techOutputRoot, { recursive: true });

  writeGzipTsv(techSource, [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
    [
      "A220-ATA56-window-page_0001.pdf",
      "A220-ATA56-window.pdf",
      "A220-ATA56-window-page_0001.json",
      "# RH Windshield Frame\nFlushness inspection around the RH windshield frame and cockpit window surround.",
      "110",
      "A220-ATA56-window-page_0001.pdf 0",
      "ATA 56",
      "RH Windshield Frame",
      "procedure",
    ],
  ]);

  const techConfig: DataprepCorpusConfig = {
    corpus: "tech_docs",
    sourceFile: techSource,
    outputRoot: techOutputRoot,
    hasHeader: true,
    normalizeRow: normalizeTechDocsPreparedRow,
  };

  const result = await runKnowledgeDataprepForCorpus(techConfig);

  assert.equal(result.recordCount, 1);
  assert.ok(result.ontology.partCount >= 1);
  assert.ok(result.wiki.pageCount >= 1);
  const wikiIndex = JSON.parse(readFileSync(result.wiki.indexPath, "utf8")) as Array<Record<string, unknown>>;
  assert.equal(String(wikiIndex[0]?.title ?? ""), "Rh Windshield Frame");
  assert.equal(String(wikiIndex[0]?.entity_type ?? ""), "part");
  assert.match(String(wikiIndex[0]?.short_description ?? ""), /ATA[- ]56|unspecified/u);
});

test("runKnowledgeDataprepForCorpus truncates oversized wiki slugs deterministically", async () => {
  const root = buildTestRoot();
  const techSource = path.join(root, "tech_docs.csv.gz");
  const techOutputRoot = path.join(root, "tech");
  mkdirSync(techOutputRoot, { recursive: true });

  writeGzipTsv(techSource, [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
    [
      "A220-ATA57-wing-page_0001.pdf",
      "A220-ATA57-wing.pdf",
      "A220-ATA57-wing-page_0001.json",
      "Wing structure inspection reference.",
      "64",
      "A220-ATA57-wing-page_0001.pdf 0",
      "ATA 57",
      "Spar Rear Spar FWD Hinge Rib 5 Hinge Rib 4 Hinge Rib 3 Hinge Rib 2 Hinge Rib 1 Closure Rib Ref Rib 7 Outb Rib 6 Outb Rib 5 Outb Rib 4 Outb Rib 3 Outb Rib 2 Outb Rib 1 Outb Splice Rib Outb Rib 9 Inbd Rib 8 Inbd Rib 7 Inbd Rib 6 Inbd Rib 5 Inbd Rib 4 Inbd Rib 3 Inbd Rib 2 Inbd Rib 1 Inbd Splice Rib Inbd",
      "procedure",
    ],
  ]);

  const techConfig: DataprepCorpusConfig = {
    corpus: "tech_docs",
    sourceFile: techSource,
    outputRoot: techOutputRoot,
    hasHeader: true,
    normalizeRow: normalizeTechDocsPreparedRow,
  };

  const result = await runKnowledgeDataprepForCorpus(techConfig);
  const wikiIndex = JSON.parse(readFileSync(result.wiki.indexPath, "utf8")) as Array<Record<string, unknown>>;
  const wikiPath = String(wikiIndex[0]?.path ?? "");
  assert.match(wikiPath, /^parts\/[a-z0-9-]+\.md$/u);
  assert.ok(wikiPath.length < 120);
});

test("runKnowledgeDataprepForCorpus filters generic section headings from wiki pages", async () => {
  const root = buildTestRoot();
  const techSource = path.join(root, "tech_docs.csv.gz");
  const techOutputRoot = path.join(root, "tech");
  mkdirSync(techOutputRoot, { recursive: true });

  writeGzipTsv(techSource, [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
    [
      "A220-ATA52-door-page_0001.pdf",
      "A220-ATA52-door.pdf",
      "A220-ATA52-door-page_0001.json",
      "# 1. Scope\n# Door Frame\nDoor frame inspection instructions.",
      "64",
      "A220-ATA52-door-page_0001.pdf 0",
      "ATA 52",
      "1. Scope; Door Frame",
      "procedure",
    ],
  ]);

  const techConfig: DataprepCorpusConfig = {
    corpus: "tech_docs",
    sourceFile: techSource,
    outputRoot: techOutputRoot,
    hasHeader: true,
    normalizeRow: normalizeTechDocsPreparedRow,
  };

  const result = await runKnowledgeDataprepForCorpus(techConfig);
  const wikiIndex = JSON.parse(readFileSync(result.wiki.indexPath, "utf8")) as Array<Record<string, unknown>>;
  const titles = wikiIndex.map((entry) => String(entry.title ?? ""));
  assert.ok(titles.includes("Door Frame"));
  assert.ok(!titles.includes("1. Scope"));
});

test("runKnowledgeDataprepForCorpus builds public image/entity artifacts from OCR captions", async () => {
  const root = buildTestRoot();
  const techSource = path.join(root, "tech_docs.csv.gz");
  const techOutputRoot = path.join(root, "tech");
  mkdirSync(path.join(techOutputRoot, "ocr"), { recursive: true });

  writeGzipTsv(techSource, [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
    [
      "A220-bleed-system_page_0001.pdf",
      "A220-bleed-system.pdf",
      "A220-bleed-system_page_0001.json",
      "# Starter Air Valve\nBleed air diagram showing Starter Air Valve control with Bleed Temperature Sensor feedback.",
      "122",
      "A220-bleed-system_page_0001.pdf 0",
      "ATA 36",
      "Starter Air Valve; Bleed Temperature Sensor",
      "diagram",
    ],
  ]);

  writeFileSync(
    path.join(techOutputRoot, "ocr", "A220-bleed-system_page_0001__with_img_desc.json"),
    JSON.stringify({
      pages: [
        {
          markdown: "![bleed diagram](img-1.png)\n\nStarter Air Valve schematic.",
          images: [{ id: "img-1", imageBase64: "data:image/png;base64,aGVsbG8=" }],
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    path.join(techOutputRoot, "ocr", "A220-bleed-system_page_0001.image-caption.json"),
    JSON.stringify({
      page_category: "technical_diagram",
      page_category_confidence: 0.98,
      is_non_content_page: false,
      retrieval_action: "index",
      retrieval_weight: 1,
      short_summary: "Bleed air schematic with starter air valve and temperature sensor.",
      technical_description:
        "Figure 02-02-4 shows the Starter Air Valve connected to the Bleed Temperature Sensor in the bleed air control loop.",
      visible_text: ["STARTER AIR VALVE", "BLEED TEMPERATURE SENSOR"],
      visible_identifiers: ["Starter Air Valve", "Bleed Temperature Sensor", "Figure 02-02-4"],
      ata_candidates: ["ATA-36"],
      part_or_zone_candidates: ["Starter Air Valve", "Bleed Temperature Sensor"],
      diagram_elements: ["valve", "sensor", "control loop"],
      relationships_or_flows: ["Starter Air Valve feeds bleed air through the control loop."],
      warnings_or_limits: [],
      figure_or_table_refs: ["Figure 02-02-4"],
      uncertainties: [],
    }),
    "utf8",
  );

  const techConfig: DataprepCorpusConfig = {
    corpus: "tech_docs",
    sourceFile: techSource,
    outputRoot: techOutputRoot,
    hasHeader: true,
    normalizeRow: normalizeTechDocsPreparedRow,
  };

  const result = await runKnowledgeDataprepForCorpus(techConfig);

  const images = JSON.parse(
    readFileSync(path.join(result.ontology.root, "images.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  assert.equal(images.length, 1);
  assert.equal(images[0]?.doc, "A220-bleed-system_page_0001.pdf");
  assert.equal(images[0]?.asset_path, "wiki/images/a220-bleed-system-page-0001-1.png");
  assert.ok(existsSync(path.join(result.ontology.root, "image-assets", "a220-bleed-system-page-0001-1.png")));
  assert.ok(existsSync(path.join(result.wiki.root, "images", "a220-bleed-system-page-0001-1.png")));

  const imageRelations = JSON.parse(
    readFileSync(path.join(result.ontology.root, "image_relations.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  assert.ok(
    imageRelations.some(
      (relation) =>
        relation.from === "part:starter-air-valve" &&
        relation.to === "image:a220-bleed-system-page-0001-1" &&
        Array.isArray(relation.reasons) &&
        relation.reasons.includes("caption_candidate"),
    ),
  );

  const wikiIndex = JSON.parse(readFileSync(result.wiki.indexPath, "utf8")) as Array<Record<string, unknown>>;
  const starterValve = wikiIndex.find((entry) => entry.slug === "starter-air-valve");
  assert.ok(starterValve);
  const linkedImages = starterValve.linked_images as Array<Record<string, unknown>>;
  assert.equal(linkedImages.length, 1);
  assert.equal(linkedImages[0]?.asset_path, "images/a220-bleed-system-page-0001-1.png");

  const wikiMarkdown = readFileSync(path.join(result.wiki.root, "parts", "starter-air-valve.md"), "utf8");
  assert.match(wikiMarkdown, /## Linked images/u);
  assert.match(wikiMarkdown, /Figure 02-02-4/u);
  assert.match(wikiMarkdown, /\.\.\/images\/a220-bleed-system-page-0001-1\.png/u);
});
