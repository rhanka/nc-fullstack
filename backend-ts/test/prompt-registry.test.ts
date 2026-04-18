import test from "node:test";
import assert from "node:assert/strict";

import { buildPromptRegistry } from "../src/services/prompt-registry.ts";

test("task 100 prompt consumes entities wiki context", () => {
  const prompts = buildPromptRegistry();
  const rendered = prompts["100"]?.render({
    role: "100",
    user_message: "Prepare analysis.",
    description: "Door frame deviation.",
    search_docs: "{}",
    search_nc: "{}",
    search_entities_wiki: JSON.stringify({
      sources: [
        {
          doc: "Door frame",
          content: "Canonical door frame entity. ATA: ATA 52. Supporting doc: door-frame.md",
          primary_doc: "door-frame.md",
        },
      ],
    }),
    history: "[]",
  });

  assert.ok(rendered);
  assert.match(rendered.system, /Entities \/ ATA \/ parts \/ zones/u);
  assert.match(rendered.system, /Canonical door frame entity/u);
  assert.match(rendered.system, /supporting_docs|primary_doc/u);
});
