import test from "node:test";
import assert from "node:assert/strict";

import type { ReferenceSourceItem, ReferenceSources } from "../src/lib/chat/contracts.ts";
import {
  buildEntityListEntry,
  chooseSelectedEntity,
  entityHasLinkedImages,
  entitySelectionKey,
  getEntityPrimaryDoc,
  getLinkedImages,
} from "../src/lib/entities/entity-ui.ts";
import { buildChatSourceGroups, getChatSourceCount } from "../src/lib/chat/source-groups.ts";

const completeEntity: ReferenceSourceItem = {
  doc: "Fuel Transfer Valve",
  title: "Fuel Transfer Valve",
  path: "wiki/fuel-transfer-valve.md",
  slug: "fuel-transfer-valve",
  ata_codes: ["ATA-28"],
  zones: ["right", "wing"],
  aliases: ["FTV", "Transfer Valve"],
  primary_doc: "a220-300-FCOM-1-1-13_page_1529.pdf",
  supporting_docs: ["a220-300-FCOM-1-1-13_page_1530.pdf", "a220-300-FCOM-1-1-13_page_1529.pdf"],
  linked_images: [{ asset_path: "wiki/images/ftv-1.png" }, { id: "figure-1", doc: "a220-300-FCOM-1-1-13_page_1529.pdf" }],
};

test("buildEntityListEntry exposes the compact complete entity card fields", () => {
  assert.deepEqual(buildEntityListEntry(completeEntity, 0), {
    title: "Fuel Transfer Valve",
    rankLabel: "#1",
    meta: "ATA-28 / Zone right / Zone wing",
    alias: "FTV, Transfer Valve",
    docsLabel: "2 docs",
    imagesLabel: "2 images",
    ariaLabel: "Open entity Fuel Transfer Valve",
  });
});

test("buildEntityListEntry degrades cleanly when entity fields are partial", () => {
  const partialEntity: ReferenceSourceItem = {
    chunk_id: "entity-42",
    aliases: ["Only alias"],
    linked_images: [],
  };

  assert.deepEqual(buildEntityListEntry(partialEntity, 4), {
    title: "entity-42",
    rankLabel: "#5",
    meta: "",
    alias: "Only alias",
    docsLabel: "",
    imagesLabel: "",
    ariaLabel: "Open entity entity-42",
  });
});

test("chooseSelectedEntity keeps the current entity when it is still present and otherwise prefers image-backed entities", () => {
  const first: ReferenceSourceItem = { doc: "A", path: "wiki/a.md" };
  const second: ReferenceSourceItem = {
    doc: "B",
    path: "wiki/b.md",
    linked_images: [{ asset_path: "wiki/images/b.png" }],
  };
  const third: ReferenceSourceItem = { doc: "C", path: "wiki/c.md" };

  assert.equal(chooseSelectedEntity([first, second, third], second), second);
  assert.equal(chooseSelectedEntity([first, second, third], { path: "wiki/missing.md" }), second);
  assert.equal(chooseSelectedEntity([first, third], null), first);
  assert.equal(chooseSelectedEntity([], second), null);
});

test("entitySelectionKey and entityHasLinkedImages normalize selection and image availability", () => {
  assert.equal(entitySelectionKey(completeEntity), "wiki/fuel-transfer-valve.md");
  assert.equal(entitySelectionKey({ slug: "fallback-slug" }), "fallback-slug");
  assert.equal(entitySelectionKey({ chunk_id: "fallback-chunk" }), "fallback-chunk");
  assert.equal(entitySelectionKey(null), null);

  assert.equal(entityHasLinkedImages(completeEntity), true);
  assert.equal(entityHasLinkedImages({ linked_images: [] }), false);
  assert.equal(entityHasLinkedImages(null), false);
});

test("getLinkedImages deduplicates repeated image records and getEntityPrimaryDoc exposes the open-document target", () => {
  const entity: ReferenceSourceItem = {
    primary_doc: "a220-300-FCOM-1-1-13_page_1529.pdf",
    linked_images: [
      { asset_path: "wiki/images/ftv-1.png", doc: "a220-300-FCOM-1-1-13_page_1529.pdf" },
      { asset_path: "wiki/images/ftv-1.png", doc: "a220-300-FCOM-1-1-13_page_1529.pdf" },
      { id: "fig-1", doc: "a220-300-FCOM-1-1-13_page_1530.pdf" },
      { id: "fig-1", doc: "a220-300-FCOM-1-1-13_page_1530.pdf" },
      { doc: "" },
    ],
  };

  assert.equal(getEntityPrimaryDoc(entity), "a220-300-FCOM-1-1-13_page_1529.pdf");
  assert.deepEqual(
    getLinkedImages(entity).map((image) => image.asset_path ?? `${image.doc}:${image.id ?? ""}`),
    ["wiki/images/ftv-1.png", "a220-300-FCOM-1-1-13_page_1530.pdf:fig-1"],
  );
});

test("buildChatSourceGroups keeps tech docs, similar NC and entities isolated for chat source rendering", () => {
  const sources: ReferenceSources = {
    tech_docs: {
      sources: [
        { doc: "tech-1.pdf", chunk_id: "tech-1" },
        { doc: "tech-2.pdf", chunk_id: "tech-2" },
      ],
    },
    non_conformities: {
      sources: [{ doc: "ATA-28-0001", chunk_id: "nc-1" }],
    },
    entities_wiki: {
      sources: [completeEntity],
    },
  };

  const groups = buildChatSourceGroups(sources);

  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.items.length]),
    [
      ["tech_docs", "Technical documents", 2],
      ["non_conformities", "Similar non-conformities", 1],
      ["entities_wiki", "Entities", 1],
    ],
  );
  assert.equal(getChatSourceCount(sources), 4);
});
