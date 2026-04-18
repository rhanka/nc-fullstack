import test from "node:test";
import assert from "node:assert/strict";

import { resolveRoute } from "../src/routes/index.ts";

test("GET /ping exposes the TS backend foundation status", async (t) => {
  void t;
  const result = resolveRoute("GET", "/ping");
  assert.equal(result.statusCode, 200);

  const body = result.body as {
    status: string;
    service: string;
    tsFoundation: boolean;
    contracts: { targetVersion: string };
    retrieval: { activeEngine: string; vectorPath: string };
    layers: string[];
  };

  assert.equal(body.status, "ok");
  assert.equal(body.service, "nc-backend-ts");
  assert.equal(body.tsFoundation, true);
  assert.equal(body.contracts.targetVersion, "ai/v2");
  assert.equal(body.retrieval.activeEngine, "export_exact");
  assert.equal(body.retrieval.vectorPath, "offline-export-exact-l2");
  assert.deepEqual(body.layers, ["contracts", "retrieval", "llm", "services", "routes"]);
});
