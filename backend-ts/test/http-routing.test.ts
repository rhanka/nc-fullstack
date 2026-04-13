import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { routeRequest } from "../src/routes/index.ts";
import { FileDataService } from "../src/services/file-data-service.ts";
import type {
  AiComputeResult,
  AiRuntime,
  AiRuntimeRequest,
  AiSourceV1Request,
  AiSourceV1Response,
  AiStreamExecution,
} from "../src/services/ai-orchestrator.ts";

function buildFakeRuntime(): AiRuntime {
  const finalPayload: AiSourceV1Response = {
    text: "Draft updated with technical references.",
    label: "Windshield skin rivet flushness out of tolerance",
    description: {
      observation: "Measured rivet flushness between -0.20 mm and -0.25 mm below the right windshield.",
    },
    sources: {
      tech_docs: {
        sources: [{ doc: "tech-doc.md", content: "technical reference" }],
      },
      non_conformities: {
        sources: [{ doc: "ATA-56-demo-case", content: "similar case", ATA_code: "ATA-56" }],
      },
    },
    user_query: "Rewrite the non-conformity report using the most relevant references.",
    input_description: "Right windshield area rivet flushness out of tolerance.",
    role: "ai",
    user_role: "000",
  };

  const computeResult: AiComputeResult = {
    payload: finalPayload,
    sessionCookie: {
      name: "nc_session_id",
      value: "session-json",
      maxAge: 3600,
      httpOnly: false,
      sameSite: "lax",
    },
  };

  const streamResult: AiStreamExecution = {
    sessionCookie: {
      name: "nc_session_id",
      value: "session-stream",
      maxAge: 3600,
      httpOnly: false,
      sameSite: "lax",
    },
    chunks: [
      'event: delta_encoding\ndata: "v1"\n\n',
      'data: {"type":"action","text":"Generate final answer","metadata":"000"}\n\n',
      'event: delta\ndata: {"v":"{\\"comment\\":\\"Draft updated\\"}","metadata":"000"}\n\n',
      `data: ${JSON.stringify({ type: "result", text: finalPayload, metadata: "final" })}\n\n`,
    ],
    completed: Promise.resolve(),
  };

  return {
    async compute(_request: AiRuntimeRequest): Promise<AiComputeResult> {
      return computeResult;
    },
    async openStream(_request: AiRuntimeRequest): Promise<AiStreamExecution> {
      return streamResult;
    }
  };
}

function buildLiveStreamRuntime(): AiRuntime {
  return {
    async compute(): Promise<AiComputeResult> {
      throw new Error("not used in this test");
    },
    async openStream(): Promise<AiStreamExecution> {
      return {
        sessionCookie: {
          name: "nc_session_id",
          value: "live-stream",
          maxAge: 3600,
          httpOnly: false,
          sameSite: "lax",
        },
        chunks: {
          async *[Symbol.asyncIterator](): AsyncIterator<string> {
            yield 'event: delta_encoding\ndata: "v1"\n\n';
            yield 'data: {"type":"action","text":"Build appropriate request","metadata":"query"}\n\n';
            yield 'event: delta\ndata: {"v":"partial","metadata":"000"}\n\n';
          },
        },
        completed: Promise.resolve(),
      };
    },
  };
}

async function createFixtureService(): Promise<FileDataService> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nc-backend-ts-http-"));
  const techDocsPagesDir = path.join(root, "tech-pages");
  const ncJsonDir = path.join(root, "nc-json");
  const ataCodesPath = path.join(root, "ata_codes.json");

  await mkdir(techDocsPagesDir, { recursive: true });
  await mkdir(ncJsonDir, { recursive: true });

  await writeFile(
    ataCodesPath,
    JSON.stringify([{ ATA_code: "ATA-56", ATA_category: "WINDOWS" }]),
    "utf8",
  );
  await writeFile(path.join(techDocsPagesDir, "doc.pdf"), Buffer.from("pdf-content"));
  await writeFile(
    path.join(ncJsonDir, "ATA-56-demo.json"),
    JSON.stringify({
      analysis_history: {
        "000": [{ label: "Window issue" }],
      },
      extra: "value",
    }),
    "utf8",
  );

  return new FileDataService({
    techDocsPagesDir,
    ncJsonDir,
    ataCodesPath,
  });
}

class MockRequest extends EventEmitter {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;

  constructor(method: string, url: string, headers: Record<string, string> = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
  }

  setEncoding(_encoding: BufferEncoding): void {}
}

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: Array<Buffer | string> = [];

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  writeHead(statusCode: number, headers: Record<string, string> = {}): void {
    this.statusCode = statusCode;
    this.headers = { ...this.headers, ...headers };
  }

  write(chunk: Buffer | string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(chunk?: Buffer | string): void {
    if (chunk !== undefined) {
      this.chunks.push(chunk);
    }
  }

  get text(): string {
    return this.chunks
      .map((chunk) => (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk))
      .join("");
  }

  get buffer(): Buffer {
    return Buffer.concat(
      this.chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
    );
  }
}

async function invokeRoute(options: {
  readonly method: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly aiRuntime?: AiRuntime;
  readonly dataService?: FileDataService;
}): Promise<MockResponse> {
  const request = new MockRequest(options.method, options.url, options.headers) as unknown as IncomingMessage;
  const response = new MockResponse() as unknown as ServerResponse & MockResponse;
  const requestPromise = routeRequest(request, response, {
    aiRuntime: options.aiRuntime,
    dataService: options.dataService,
  });

  await Promise.resolve();
  if (options.body !== undefined) {
    (request as unknown as EventEmitter).emit("data", options.body);
  }
  (request as unknown as EventEmitter).emit("end");

  await requestPromise;
  return response;
}

test("routeRequest serves /ai, /nc and /doc over HTTP handlers", async () => {
  const dataService = await createFixtureService();
  const aiRuntime = buildFakeRuntime();

  const requestBody: AiSourceV1Request = {
    provider: "openai",
    messages: [
      {
        role: "000",
        text: "Rewrite the non-conformity report using the most relevant references.",
        description: "Right windshield area rivet flushness out of tolerance.",
        history: [],
      },
    ],
  };

  const aiJsonResponse = await invokeRoute({
    method: "POST",
    url: "/ai",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
    aiRuntime,
  });

  assert.equal(aiJsonResponse.statusCode, 200);
  assert.equal(aiJsonResponse.headers["content-type"], "application/json; charset=utf-8");
  assert.match(aiJsonResponse.headers["set-cookie"] ?? "", /^nc_session_id=session-json;/);
  assert.deepEqual(JSON.parse(aiJsonResponse.text), {
    text: "Draft updated with technical references.",
    label: "Windshield skin rivet flushness out of tolerance",
    description: {
      observation: "Measured rivet flushness between -0.20 mm and -0.25 mm below the right windshield.",
    },
    sources: {
      tech_docs: {
        sources: [{ doc: "tech-doc.md", content: "technical reference" }],
      },
      non_conformities: {
        sources: [{ doc: "ATA-56-demo-case", content: "similar case", ATA_code: "ATA-56" }],
      },
    },
    user_query: "Rewrite the non-conformity report using the most relevant references.",
    input_description: "Right windshield area rivet flushness out of tolerance.",
    role: "ai",
    user_role: "000",
  });

  const streamResponse = await invokeRoute({
    method: "POST",
    url: "/ai",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(requestBody),
    aiRuntime,
  });

  assert.equal(streamResponse.statusCode, 200);
  assert.equal(streamResponse.headers["content-type"], "text/event-stream");
  assert.match(streamResponse.headers["set-cookie"] ?? "", /^nc_session_id=session-stream;/);
  assert.match(streamResponse.text, /event: delta_encoding/);
  assert.match(streamResponse.text, /event: delta/);
  assert.match(streamResponse.text, /Generate final answer/);
  assert.match(streamResponse.text, /"metadata":"final"/);

  const listResponse = await invokeRoute({
    method: "GET",
    url: "/nc?max_rows=1",
    dataService,
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.headers["content-type"], "application/json; charset=utf-8");
  const listBody = JSON.parse(listResponse.text) as Array<Record<string, unknown>>;
  assert.equal(listBody.length, 1);
  assert.equal(listBody[0]?.doc, "ATA-56-demo");
  assert.equal(listBody[0]?.ATA_code, "ATA-56");
  assert.deepEqual(listBody[0]?.analysis_history, {
    analysis_history: {
      "000": [{ label: "Window issue" }],
    },
    extra: "value",
  });

  const ncJsonResponse = await invokeRoute({
    method: "GET",
    url: "/nc/json/ATA-56-demo.json",
    dataService,
  });
  assert.equal(ncJsonResponse.statusCode, 200);
  const ncJsonBody = JSON.parse(ncJsonResponse.text) as Record<string, unknown>;
  assert.equal(ncJsonBody.doc, "ATA-56-demo");
  assert.equal(ncJsonBody.nc_event_id, "ATA-56-demo");
  assert.equal(ncJsonBody.ATA_category, "WINDOWS");
  assert.deepEqual(ncJsonBody.analysis_history, {
    analysis_history: {
      "000": [{ label: "Window issue" }],
    },
    extra: "value",
  });

  const detailsResponse = await invokeRoute({
    method: "POST",
    url: "/nc",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nc_event_ids: ["ATA-56-demo"] }),
    dataService,
  });
  assert.equal(detailsResponse.statusCode, 200);
  const detailsBody = JSON.parse(detailsResponse.text) as Array<Record<string, unknown>>;
  assert.equal(detailsBody.length, 1);
  assert.equal(detailsBody[0]?.doc, "ATA-56-demo");

  const docResponse = await invokeRoute({
    method: "GET",
    url: "/doc/doc.pdf",
    dataService,
  });
  assert.equal(docResponse.statusCode, 200);
  assert.equal(docResponse.headers["content-type"], "application/pdf");
  assert.match(docResponse.headers["content-disposition"] ?? "", /inline; filename\*=UTF-8''doc\.pdf/);
  assert.equal(docResponse.buffer.toString("utf8"), "pdf-content");
});

test("routeRequest handles CORS preflight with credentials", async () => {
  const response = await invokeRoute({
    method: "OPTIONS",
    url: "/ai",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.equal(response.headers["access-control-allow-headers"], "content-type");
});

test("routeRequest uses the live openStream runtime path when available", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/ai",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      cookie: "nc_session_id=live-stream",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "000",
          text: "Help me rewrite this draft.",
        },
      ],
    } satisfies AiSourceV1Request),
    aiRuntime: buildLiveStreamRuntime(),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream");
  assert.match(response.headers["set-cookie"] ?? "", /^nc_session_id=live-stream;/);
  assert.match(response.text, /event: delta_encoding/);
  assert.match(response.text, /Build appropriate request/);
  assert.match(response.text, /event: delta/);
});
