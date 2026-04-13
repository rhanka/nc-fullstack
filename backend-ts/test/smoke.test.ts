import test from "node:test";
import assert from "node:assert/strict";

import { resolveRoute } from "../src/routes/index.ts";

test("GET /ping exposes the TS backend foundation status", async (t) => {
  void t;
  const previousEngine = process.env.NC_RETRIEVAL_ENGINE;
  process.env.NC_RETRIEVAL_ENGINE = "export_exact";

  try {
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
  } finally {
    if (previousEngine === undefined) {
      delete process.env.NC_RETRIEVAL_ENGINE;
    } else {
      process.env.NC_RETRIEVAL_ENGINE = previousEngine;
    }
  }
});

test("GET /ping exposes LanceDB when the runtime is switched", async () => {
  const previousEngine = process.env.NC_RETRIEVAL_ENGINE;
  process.env.NC_RETRIEVAL_ENGINE = "lancedb";

  try {
    const result = resolveRoute("GET", "/ping");
    assert.equal(result.statusCode, 200);

    const body = result.body as {
      retrieval: { activeEngine: string; vectorPath: string };
    };

    assert.equal(body.retrieval.activeEngine, "lancedb");
    assert.equal(body.retrieval.vectorPath, "lancedb-local");
  } finally {
    if (previousEngine === undefined) {
      delete process.env.NC_RETRIEVAL_ENGINE;
    } else {
      process.env.NC_RETRIEVAL_ENGINE = previousEngine;
    }
  }
});
