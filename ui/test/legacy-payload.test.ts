import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLegacyFinalPayload } from "../src/lib/chat/legacy-payload.ts";

test("normalizeLegacyFinalPayload clears embedded structured JSON text when there is no comment", () => {
  const payload = normalizeLegacyFinalPayload({
    text: JSON.stringify({
      label: "Potentially significant aluminium surface scratch",
      description: {
        synthesis: "Conservative quarantine pending calibrated depth verification.",
      },
    }),
  });

  assert.equal(payload.text, undefined);
  assert.equal(payload.label, "Potentially significant aluminium surface scratch");
  assert.deepEqual(payload.description, {
    synthesis: "Conservative quarantine pending calibrated depth verification.",
  });
});

test("normalizeLegacyFinalPayload keeps the embedded comment as visible assistant text when present", () => {
  const payload = normalizeLegacyFinalPayload({
    text: JSON.stringify({
      label: "Potentially significant aluminium surface scratch",
      description: {
        synthesis: "Conservative quarantine pending calibrated depth verification.",
      },
      comment: "Draft updated from technical evidence.",
    }),
  });

  assert.equal(payload.text, "Draft updated from technical evidence.");
  assert.equal(payload.label, "Potentially significant aluminium surface scratch");
  assert.deepEqual(payload.description, {
    synthesis: "Conservative quarantine pending calibrated depth verification.",
  });
});
