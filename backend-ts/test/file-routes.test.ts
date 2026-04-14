import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { handleDocRoute } from "../src/routes/doc-route.ts";
import {
  handleNcDetailsRoute,
  handleNcJsonRoute,
  handleNcListRoute,
} from "../src/routes/nc-route.ts";
import { FileDataService } from "../src/services/file-data-service.ts";

async function createFixtureService(options: {
  readonly createNcDir?: boolean;
  readonly invalidJson?: boolean;
} = {}): Promise<FileDataService> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nc-backend-ts-routes-"));
  const techDocsPagesDir = path.join(root, "tech-pages");
  const ncJsonDir = path.join(root, "nc-json");
  const ataCodesPath = path.join(root, "ata_codes.json");

  await mkdir(techDocsPagesDir, { recursive: true });
  if (options.createNcDir !== false) {
    await mkdir(ncJsonDir, { recursive: true });
  }

  await writeFile(
    ataCodesPath,
    JSON.stringify([{ ATA_code: "ATA-56", ATA_category: "WINDOWS" }]),
    "utf8",
  );
  await writeFile(path.join(techDocsPagesDir, "doc.pdf"), Buffer.from("pdf-content"));
  if (options.createNcDir !== false) {
    await writeFile(
      path.join(ncJsonDir, "ATA-56-demo.json"),
      options.invalidJson
        ? '{"analysis_history": {"000": [}'
        : JSON.stringify({
            analysis_history: {
              "000": [{ label: "Window issue" }],
            },
            extra: "value",
          }),
      "utf8",
    );
  }

  return new FileDataService({
    techDocsPagesDir,
    ncJsonDir,
    ataCodesPath,
  });
}

test("handleDocRoute serves PDF files from the TS runtime", async () => {
  const service = await createFixtureService();
  const result = await handleDocRoute("/doc/doc.pdf", service);

  assert.ok(result);
  assert.equal(result!.statusCode, 200);
  assert.equal(result!.headers["content-type"], "application/pdf");
  assert.ok(Buffer.isBuffer(result!.body));
  assert.equal((result!.body as Buffer).toString("utf8"), "pdf-content");
});

test("handleNcJsonRoute returns ATA-enriched JSON", async () => {
  const service = await createFixtureService();
  const result = await handleNcJsonRoute("/nc/json/ATA-56-demo.json", service);

  assert.ok(result);
  assert.equal(result!.statusCode, 200);
  assert.deepEqual(result!.body, {
    analysis_history: {
      analysis_history: {
        "000": [{ label: "Window issue" }],
      },
      extra: "value",
    },
    doc: "ATA-56-demo",
    nc_event_id: "ATA-56-demo",
    ATA_code: "ATA-56",
    ATA_category: "WINDOWS",
  });
});

test("handleNcListRoute respects max_rows and id filters", async () => {
  const service = await createFixtureService();

  const allRows = await handleNcListRoute(new URLSearchParams("max_rows=1"), service);
  assert.equal(allRows.statusCode, 200);
  assert.equal((allRows.body as unknown[]).length, 1);

  const filtered = await handleNcListRoute(new URLSearchParams("id=ATA-56-demo"), service);
  assert.equal(filtered.statusCode, 200);
  assert.equal((filtered.body as unknown[]).length, 1);
});

test("handleNcDetailsRoute returns requested ids and rejects invalid payloads", async () => {
  const service = await createFixtureService();

  const okResult = await handleNcDetailsRoute({ nc_event_ids: ["ATA-56-demo"] }, service);
  assert.equal(okResult.statusCode, 200);
  assert.equal((okResult.body as unknown[]).length, 1);

  const badResult = await handleNcDetailsRoute({ nc_event_ids: "ATA-56-demo" }, service);
  assert.equal(badResult.statusCode, 400);
  assert.deepEqual(badResult.body, {
    detail: 'Invalid payload: "nc_event_ids" should be a list.',
  });
});

test("handleNcListRoute returns an empty list when the NC directory is missing", async () => {
  const service = await createFixtureService({ createNcDir: false });
  const result = await handleNcListRoute(new URLSearchParams("max_rows=10"), service);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, []);
});

test("handleNcJsonRoute surfaces invalid JSON as a 500", async () => {
  const service = await createFixtureService({ invalidJson: true });
  const result = await handleNcJsonRoute("/nc/json/ATA-56-demo.json", service);

  assert.ok(result);
  assert.equal(result!.statusCode, 500);
  assert.deepEqual(result!.body, {
    detail: "Invalid JSON file",
  });
});
