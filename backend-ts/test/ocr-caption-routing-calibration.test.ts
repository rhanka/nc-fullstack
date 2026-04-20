import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compareRoutingDecisionWithLabel,
  normalizeImageCaptionV2,
  OpenAIImageCaptionV2Client,
  routeImageCaptionV2,
  runOcrCaptionRoutingCalibration,
  type ImageCaptionV2Client,
} from "../src/dataprep/ocr-caption-routing-calibration.ts";

function buildRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-ocr-caption-routing-"));
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

function mockV2Client(): ImageCaptionV2Client {
  return {
    provider: "mock",
    model: "gpt-5.4-nano",
    async analyzePage(input) {
      const isDiagram = /bus|diagram|architecture/iu.test(input.markdown);
      return normalizeImageCaptionV2({
        schema_version: "a220_image_caption_v2",
        page_category: "technical_diagram",
        page_category_confidence: 0.8,
        retrieval_action: "index",
        retrieval_weight: 1,
        short_summary: "Caption for " + input.doc,
        technical_description: "Caption for " + input.doc,
        visible_identifiers: isDiagram ? ["ARINC 429", "EEC"] : ["ATA 52"],
        ata_candidates: ["ATA 52"],
        routing_profile_v1: {
          visual_content_type: isDiagram ? "wiring_signal_bus_diagram" : "technical_photo",
          domain_candidates: isDiagram ? ["avionics_electrical"] : ["doors"],
          rag_signal: {
            ocr_markdown_sufficient: false,
            visual_caption_adds_retrieval_terms: true,
            retrieval_terms: isDiagram ? ["ARINC 429", "CAN BUS", "EEC"] : ["door handle"],
          },
          wiki_signal: {
            has_named_entities: true,
            has_entity_relationships: isDiagram,
            has_part_zone_or_ata_candidates: true,
            has_component_hierarchy: false,
            entity_candidates: [{ label: "EEC", type: "system_component", evidence: "visible block label" }],
            relationship_candidates: isDiagram
              ? [{ source: "Sensor", relation: "sends_signal_to", target: "EEC", evidence: "visible bus line" }]
              : [],
          },
          routing_evidence: ["mock evidence"],
        },
      });
    },
  };
}

test("normalizeImageCaptionV2 keeps v1 fields and controlled routing profile values", () => {
  const caption = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_diagram",
    page_category_confidence: 0.8,
    retrieval_action: "index",
    short_summary: "Fuel transfer diagram.",
    technical_description: "Fuel transfer from tank to engine through valves.",
    routing_profile_v1: {
      visual_content_type: "fuel_oil_hydraulic_transfer_diagram",
      domain_candidates: ["fuel", "made_up_domain"],
      rag_signal: {
        ocr_markdown_sufficient: false,
        visual_caption_adds_retrieval_terms: true,
        retrieval_terms: ["fuel valve", { label: "tank" }],
      },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: false,
        entity_candidates: [{ label: "Fuel Valve", type: "valve", evidence: "visible label" }],
        relationship_candidates: [
          { source: "Tank", relation: "transfers_to", target: "Valve", evidence: "arrow direction" },
        ],
      },
      routing_evidence: ["arrow direction", { label: "valve label" }],
    },
  });

  assert.equal(caption.schema_version, "a220_image_caption_v2");
  assert.equal(caption.page_category, "technical_diagram");
  assert.deepEqual(caption.routing_profile_v1.domain_candidates, ["fuel", "unknown"]);
  assert.deepEqual(caption.routing_profile_v1.rag_signal.retrieval_terms, ["fuel valve", "label: tank"]);
  assert.deepEqual(caption.routing_profile_v1.routing_evidence, ["arrow direction", "label: valve label"]);
});

test("routeImageCaptionV2 routes relationship-heavy diagrams to gpt-5.4 and simple content to nano", () => {
  const deepDiagram = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_diagram",
    short_summary: "Bus architecture.",
    routing_profile_v1: {
      visual_content_type: "wiring_signal_bus_diagram",
      domain_candidates: ["avionics_electrical"],
      rag_signal: { ocr_markdown_sufficient: false, visual_caption_adds_retrieval_terms: true, retrieval_terms: [] },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: false,
        entity_candidates: [],
        relationship_candidates: [],
      },
      routing_evidence: ["bus labels"],
    },
  });
  const simplePhoto = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_photo",
    short_summary: "Door handle photo.",
    routing_profile_v1: {
      visual_content_type: "technical_photo",
      domain_candidates: ["doors"],
      rag_signal: { ocr_markdown_sufficient: true, visual_caption_adds_retrieval_terms: true, retrieval_terms: ["door"] },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: false,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: false,
        entity_candidates: [],
        relationship_candidates: [],
      },
      routing_evidence: ["single component"],
    },
  });

  assert.equal(routeImageCaptionV2(deepDiagram).route, "gpt-5.4");
  assert.equal(routeImageCaptionV2(simplePhoto).route, "nano");
});

test("routeImageCaptionV2 keeps dense tables and ordinary panels on nano unless the visual type is high-value", () => {
  const denseTable = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_table",
    short_summary: "Oil indications table.",
    routing_profile_v1: {
      visual_content_type: "technical_table",
      domain_candidates: ["power_plant_oil"],
      rag_signal: { ocr_markdown_sufficient: true, visual_caption_adds_retrieval_terms: true, retrieval_terms: [] },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: true,
        entity_candidates: Array.from({ length: 8 }, (_, index) => ({
          label: "Oil indication " + String(index),
          type: "system_component",
          evidence: "table row",
        })),
        relationship_candidates: Array.from({ length: 6 }, (_, index) => ({
          source: "Oil indication " + String(index),
          relation: "indicates",
          target: "EICAS",
          evidence: "table relation",
        })),
      },
      routing_evidence: ["table already OCR-readable"],
    },
  });
  const ordinaryPanel = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_diagram",
    short_summary: "Chronometer panel.",
    routing_profile_v1: {
      visual_content_type: "cockpit_panel_or_display",
      domain_candidates: ["avionics_electrical"],
      rag_signal: { ocr_markdown_sufficient: false, visual_caption_adds_retrieval_terms: true, retrieval_terms: [] },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: true,
        entity_candidates: Array.from({ length: 7 }, (_, index) => ({
          label: "Chronometer control " + String(index),
          type: "panel",
          evidence: "visible label",
        })),
        relationship_candidates: Array.from({ length: 5 }, (_, index) => ({
          source: "Chronometer control " + String(index),
          relation: "controls",
          target: "Chronometer",
          evidence: "panel grouping",
        })),
      },
      routing_evidence: ["ordinary panel grouping"],
    },
  });
  const flightControlsPanel = normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: "technical_diagram",
    short_summary: "Autothrottle panel.",
    routing_profile_v1: {
      visual_content_type: "cockpit_panel_or_display",
      domain_candidates: ["flight_controls"],
      rag_signal: { ocr_markdown_sufficient: false, visual_caption_adds_retrieval_terms: true, retrieval_terms: [] },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: true,
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: true,
        entity_candidates: Array.from({ length: 9 }, (_, index) => ({
          label: "Autothrottle mode " + String(index),
          type: "display",
          evidence: "mode label",
        })),
        relationship_candidates: Array.from({ length: 5 }, (_, index) => ({
          source: "Autothrottle mode " + String(index),
          relation: "indicates",
          target: "FMA",
          evidence: "mode/state link",
        })),
      },
      routing_evidence: ["flight-control mode/state relationships"],
    },
  });

  assert.equal(routeImageCaptionV2(denseTable).route, "nano");
  assert.equal(routeImageCaptionV2(ordinaryPanel).route, "nano");
  assert.equal(routeImageCaptionV2(flightControlsPanel).route, "gpt-5.4");
});

test("compareRoutingDecisionWithLabel marks false nano and false gpt-5.4 cases", () => {
  assert.equal(compareRoutingDecisionWithLabel("nano", "deep_useful_for_wiki").outcome, "false_nano");
  assert.equal(compareRoutingDecisionWithLabel("gpt-5.4", "nano_sufficient").outcome, "false_gpt54");
  assert.equal(compareRoutingDecisionWithLabel("nano", "ambiguous").outcome, "ambiguous");
  assert.equal(compareRoutingDecisionWithLabel("gpt-5.4", "deep_required").outcome, "match");
});

test("runOcrCaptionRoutingCalibration writes replay results and metrics without live network", async () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  const outputDir = path.join(root, "routing");
  const labelsPath = path.join(root, "labels.json");
  mkdirSync(ocrDir, { recursive: true });
  writeOcrPage(ocrDir, "A-photo_page_0001", "# Door photo\n\n![img](img.jpeg)\nATA 52", ["aGVsbG8="]);
  writeOcrPage(ocrDir, "B-bus_page_0002", "# Architecture diagram\n\nCAN BUS to EEC\n![img](img.jpeg)", ["aGVsbG8="]);
  writeFileSync(
    labelsPath,
    JSON.stringify(
      {
        "A-photo_page_0001.pdf": "deep_required",
        "B-bus_page_0002.pdf": "nano_sufficient",
      },
      null,
      2,
    ),
  );

  const result = await runOcrCaptionRoutingCalibration({
    ocrDir,
    outputDir,
    labelsPath,
    limit: 2,
    client: mockV2Client(),
  });

  assert.equal(result.sampleCount, 2);
  assert.equal(result.metrics.falseNano, 1);
  assert.equal(result.metrics.falseGpt54, 1);
  assert.equal(result.metrics.routedNano, 1);
  assert.equal(result.metrics.routedGpt54, 1);
  assert.equal(result.decision, "revise_matrix");
  assert.ok(existsSync(result.resultsPath));
  assert.ok(existsSync(result.reportPath));
  assert.match(readFileSync(result.reportPath, "utf8"), /False nano: 1/u);
  assert.match(readFileSync(result.reportPath, "utf8"), /False gpt-5\.4: 1/u);
});

test("runOcrCaptionRoutingCalibration resumes from cached replay result files", async () => {
  const root = buildRoot();
  const ocrDir = path.join(root, "ocr");
  const outputDir = path.join(root, "routing");
  mkdirSync(ocrDir, { recursive: true });
  writeOcrPage(ocrDir, "A-photo_page_0001", "# Door photo\n\n![img](img.jpeg)\nATA 52", ["aGVsbG8="]);

  await runOcrCaptionRoutingCalibration({
    ocrDir,
    outputDir,
    limit: 1,
    client: mockV2Client(),
  });

  const result = await runOcrCaptionRoutingCalibration({
    ocrDir,
    outputDir,
    limit: 1,
    client: {
      provider: "mock",
      model: "gpt-5.4-nano",
      async analyzePage() {
        throw new Error("live client should not be called for cached routing calibration result");
      },
    },
  });

  assert.equal(result.sampleCount, 1);
  assert.equal(result.results[0]?.status, "ok");
  assert.equal(result.results[0]?.caption?.schema_version, "a220_image_caption_v2");
});

test("OpenAIImageCaptionV2Client sends OCR images, v2 prompt and an abort signal", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  let capturedSignal: AbortSignal | null = null;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          schema_version: "a220_image_caption_v2",
          page_category: "technical_diagram",
          short_summary: "Bus diagram.",
          technical_description: "Bus diagram.",
          routing_profile_v1: {
            visual_content_type: "wiring_signal_bus_diagram",
            domain_candidates: ["avionics_electrical"],
            rag_signal: {
              ocr_markdown_sufficient: false,
              visual_caption_adds_retrieval_terms: true,
              retrieval_terms: ["ARINC 429"],
            },
            wiki_signal: {
              has_named_entities: true,
              has_entity_relationships: true,
              has_part_zone_or_ata_candidates: true,
              has_component_hierarchy: false,
              entity_candidates: [],
              relationship_candidates: [],
            },
            routing_evidence: ["visible bus label"],
          },
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new OpenAIImageCaptionV2Client({
      apiKey: "test-key",
      model: "gpt-5.4-nano",
      timeoutMs: 12_345,
    });
    const result = await client.analyzePage({
      doc: "A-bus_page_0001.pdf",
      markdown: "# CAN BUS",
      imageDataUrls: ["data:image/jpeg;base64,aGVsbG8="],
    });

    assert.equal(result.schema_version, "a220_image_caption_v2");
    assert.match(capturedBody, /a220_image_caption_v2/u);
    assert.match(capturedBody, /data:image\/jpeg;base64,aGVsbG8=/u);
    assert.ok(capturedSignal);
    assert.equal(capturedSignal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
