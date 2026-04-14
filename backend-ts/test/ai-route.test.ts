import test from "node:test";
import assert from "node:assert/strict";

import { handleAiRoute, validateAiRequestBody } from "../src/routes/ai-route.ts";
import type {
  AiComputeResult,
  AiRuntime,
  AiRuntimeRequest,
  AiSourceV1Request,
  AiSourceV1Response,
  AiStreamExecution,
} from "../src/services/ai-orchestrator.ts";

const requestBody: AiSourceV1Request = {
  messages: [
    {
      role: "000",
      text: "Rewrite the non-conformity report using the most relevant references.",
      description: "Right windshield area rivet flushness out of tolerance.",
      history: [],
    },
  ],
};

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

let lastRuntimeRequest: AiRuntimeRequest | null = null;

const fakeRuntime: AiRuntime = {
  async compute(request: AiRuntimeRequest): Promise<AiComputeResult> {
    lastRuntimeRequest = request;
    return computeResult;
  },
  async openStream(request: AiRuntimeRequest): Promise<AiStreamExecution> {
    lastRuntimeRequest = request;
    return streamResult;
  },
};

test("validateAiRequestBody accepts provider-less source-v1 requests", () => {
  assert.equal(validateAiRequestBody(requestBody), true);
  assert.equal(validateAiRequestBody({ provider: "openai", messages: [] }), true);
  assert.equal(validateAiRequestBody({ messages: [] }), true);
  assert.equal(
    validateAiRequestBody({
      provider: "openai",
      modelSelection: "gpt-5.4",
      complexitySelection: "deep",
      messages: [],
    }),
    true,
  );
  assert.equal(validateAiRequestBody({ provider: 123, messages: [] }), false);
  assert.equal(validateAiRequestBody({ provider: "openai" }), false);
  assert.equal(validateAiRequestBody({ messages: [], modelSelection: 123 }), false);
  assert.equal(validateAiRequestBody({ messages: [], complexitySelection: 123 }), false);
});

test("handleAiRoute returns JSON payload, defaults provider, and sets cookie", async () => {
  lastRuntimeRequest = null;
  const result = await handleAiRoute(requestBody, {
    wantsStream: false,
    runtime: fakeRuntime,
    cookies: { nc_session_id: "incoming-session" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["content-type"], "application/json; charset=utf-8");
  assert.match(result.headers["set-cookie"] ?? "", /^nc_session_id=session-json;/);
  assert.deepEqual(result.body, finalPayload);
  assert.deepEqual(lastRuntimeRequest, {
    body: { ...requestBody, provider: "openai" },
    cookies: { nc_session_id: "incoming-session" },
  });
});

test("handleAiRoute returns runtime SSE chunks and set-cookie for stream requests", async () => {
  lastRuntimeRequest = null;
  const result = await handleAiRoute(
    { ...requestBody, provider: "openai" },
    {
      wantsStream: true,
      runtime: fakeRuntime,
      cookies: {},
    },
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["content-type"], "text/event-stream");
  assert.match(result.headers["set-cookie"] ?? "", /^nc_session_id=session-stream;/);
  assert.deepEqual(result.streamChunks, [...streamResult.chunks]);
  assert.deepEqual(lastRuntimeRequest, {
    body: { ...requestBody, provider: "openai" },
    cookies: {},
  });
});

test("handleAiRoute rejects empty messages with legacy error detail", async () => {
  const result = await handleAiRoute(
    { provider: "openai", messages: [] },
    {
      wantsStream: false,
      runtime: fakeRuntime,
    },
  );

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { detail: "messages field required" });
});
