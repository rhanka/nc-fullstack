import test from "node:test";
import assert from "node:assert/strict";

import {
  OcrCaptionCascadeClient,
  type ImageCaptionV2ClientFactory,
} from "../src/dataprep/ocr-caption-cascade.ts";
import { normalizeImageCaptionV2, type ImageCaptionV2 } from "../src/dataprep/ocr-caption-routing-calibration.ts";

function caption(type: string, description: string): ImageCaptionV2 {
  return normalizeImageCaptionV2({
    schema_version: "a220_image_caption_v2",
    page_category: type === "technical_photo" ? "technical_photo" : "technical_diagram",
    page_category_confidence: 0.8,
    retrieval_action: "index",
    retrieval_weight: 1,
    short_summary: description,
    technical_description: description,
    routing_profile_v1: {
      visual_content_type: type,
      domain_candidates: type === "flow_diagram" ? ["fuel"] : ["doors"],
      rag_signal: {
        ocr_markdown_sufficient: false,
        visual_caption_adds_retrieval_terms: true,
        retrieval_terms: ["visible term"],
      },
      wiki_signal: {
        has_named_entities: true,
        has_entity_relationships: type === "flow_diagram",
        has_part_zone_or_ata_candidates: true,
        has_component_hierarchy: false,
        entity_candidates: [],
        relationship_candidates: [],
      },
      routing_evidence: ["test evidence"],
    },
  });
}

function factory(results: Record<string, ImageCaptionV2 | Error>): ImageCaptionV2ClientFactory {
  return (model) => ({
    provider: "mock",
    model,
    async analyzePage() {
      const result = results[model];
      if (!result) {
        throw new Error("unexpected model call: " + model);
      }
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  });
}

test("OcrCaptionCascadeClient keeps nano result when routing does not require deep pass", async () => {
  const client = new OcrCaptionCascadeClient({
    primaryModel: "gpt-5.4-nano",
    deepModel: "gpt-5.4",
    clientFactory: factory({
      "gpt-5.4-nano": caption("technical_photo", "Nano photo caption."),
    }),
  });

  const analysis = await client.analyzePage({
    doc: "door_page_0001.pdf",
    markdown: "# Door photo",
    imageDataUrls: ["data:image/jpeg;base64,aGVsbG8="],
  });

  assert.equal(analysis.technical_description, "Nano photo caption.");
  assert.equal(client.getLastAudit()?.selectedModel, "gpt-5.4-nano");
  assert.equal(client.getLastAudit()?.trigger, "nano_route");
});

test("OcrCaptionCascadeClient uses gpt-5.4 for calibrated high-value visual types", async () => {
  const client = new OcrCaptionCascadeClient({
    primaryModel: "gpt-5.4-nano",
    deepModel: "gpt-5.4",
    clientFactory: factory({
      "gpt-5.4-nano": caption("flow_diagram", "Nano flow caption."),
      "gpt-5.4": caption("flow_diagram", "Deep flow caption with transfer relationships."),
    }),
  });

  const analysis = await client.analyzePage({
    doc: "fuel_page_0001.pdf",
    markdown: "# Fuel flow",
    imageDataUrls: ["data:image/jpeg;base64,aGVsbG8="],
  });

  assert.equal(analysis.technical_description, "Deep flow caption with transfer relationships.");
  assert.equal(client.getLastAudit()?.selectedModel, "gpt-5.4");
  assert.equal(client.getLastAudit()?.trigger, "routing_deep_pass");
  assert.equal(client.getLastAudit()?.route, "gpt-5.4");
});

test("OcrCaptionCascadeClient separates technical retry from routing deep pass", async () => {
  const client = new OcrCaptionCascadeClient({
    primaryModel: "gpt-5.4-nano",
    deepModel: "gpt-5.4",
    clientFactory: factory({
      "gpt-5.4-nano": new SyntaxError("invalid nano JSON"),
      "gpt-5.4": caption("technical_photo", "Deep retry caption."),
    }),
  });

  const analysis = await client.analyzePage({
    doc: "retry_page_0001.pdf",
    markdown: "# Retry",
    imageDataUrls: ["data:image/jpeg;base64,aGVsbG8="],
  });

  assert.equal(analysis.technical_description, "Deep retry caption.");
  assert.equal(client.getLastAudit()?.selectedModel, "gpt-5.4");
  assert.equal(client.getLastAudit()?.trigger, "technical_retry");
  assert.match(client.getLastAudit()?.primaryError ?? "", /invalid nano JSON/u);
});
