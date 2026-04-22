import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEntityRelationshipGroups,
  type EntityRelationshipSource,
} from "../src/lib/entities/entity-relationship-groups.ts";

const selected: EntityRelationshipSource = {
  slug: "starter-air-valve",
  title: "Starter Air Valve",
  ata_codes: ["ATA-36"],
  zones: ["right"],
  supporting_docs: ["bleed-page-001.pdf"],
  linked_images: [{ id: "bleed-image-1" }],
};

test("buildEntityRelationshipGroups classifies neighboring entities by simple graph classes", () => {
  const groups = buildEntityRelationshipGroups(selected, [
    selected,
    {
      slug: "bleed-temperature-sensor",
      title: "Bleed Temperature Sensor",
      ata_codes: ["ATA-36"],
      zones: ["right"],
      supporting_docs: ["bleed-page-002.pdf"],
      linked_images: [{ id: "bleed-image-1" }],
    },
    {
      slug: "pressure-regulating-valve",
      title: "Pressure Regulating Valve",
      ata_codes: ["ATA-36"],
      zones: ["left"],
      supporting_docs: ["bleed-page-001.pdf"],
      linked_images: [{ id: "other-image" }],
    },
    {
      slug: "cargo-door",
      title: "Cargo Door",
      ata_codes: ["ATA-52"],
      zones: ["right"],
      supporting_docs: ["door-page-001.pdf"],
    },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.title)]),
    [
      ["Same answer", ["Bleed Temperature Sensor", "Pressure Regulating Valve", "Cargo Door"]],
      ["Image-linked", ["Bleed Temperature Sensor"]],
      ["Same document", ["Pressure Regulating Valve"]],
      ["Same ATA", ["Bleed Temperature Sensor", "Pressure Regulating Valve"]],
      ["Same zone", ["Bleed Temperature Sensor", "Cargo Door"]],
    ],
  );
});

test("buildEntityRelationshipGroups omits empty classes and keeps stable item limits", () => {
  const groups = buildEntityRelationshipGroups(selected, [
    selected,
    ...Array.from({ length: 12 }, (_, index) => ({
      slug: `entity-${index}`,
      title: `Entity ${index}`,
    })),
  ]);

  assert.deepEqual(groups.map((group) => group.label), ["Same answer"]);
  assert.equal(groups[0]?.items.length, 10);
  assert.equal(groups[0]?.items[0]?.title, "Entity 0");
});
