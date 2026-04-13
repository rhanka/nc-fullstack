import assert from "node:assert/strict";
import test from "node:test";

import { createLlmRuntime, normalizeLlmCallOptions } from "../src/llm/index.ts";
import type {
  LlmResponse,
  LlmStreamEvent,
  LlmTransport,
  NormalizedLlmCallOptions,
} from "../src/llm/index.ts";

function buildResponse(input: NormalizedLlmCallOptions): LlmResponse {
  return {
    providerId: input.providerId,
    model: input.model,
    text: "stubbed-response",
    jsonMode: input.jsonMode,
    responseId: "resp_stub",
    reasoningSummary: null,
  };
}

test("normalizeLlmCallOptions applies deterministic defaults", () => {
  const normalized = normalizeLlmCallOptions({
    providerId: "openai",
    model: "gpt-5.4-nano",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.deepEqual(normalized, {
    providerId: "openai",
    model: "gpt-5.4-nano",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: null },
    jsonMode: false,
    stream: false,
    maxOutputTokens: null,
  });
});

test("runtime.invoke forwards reasoning, json mode and output limits", async () => {
  let captured: NormalizedLlmCallOptions | null = null;
  const transport: LlmTransport = {
    async invoke(input) {
      captured = input;
      return buildResponse(input);
    },
    async *stream(): AsyncIterable<LlmStreamEvent> {
      yield { type: "completed", text: "unused" };
    },
  };

  const runtime = createLlmRuntime(transport);
  const response = await runtime.invoke({
    providerId: "openai",
    model: "gpt-5.4",
    messages: [{ role: "user", content: "analyse" }],
    reasoning: { effort: "xhigh" },
    jsonMode: true,
    maxOutputTokens: 2048,
  });

  assert.notEqual(captured, null);
  assert.equal(captured?.reasoning.effort, "xhigh");
  assert.equal(captured?.jsonMode, true);
  assert.equal(captured?.stream, false);
  assert.equal(captured?.maxOutputTokens, 2048);
  assert.equal(response.model, "gpt-5.4");
  assert.equal(response.jsonMode, true);
  assert.equal(response.responseId, "resp_stub");
});

test("runtime.stream forces stream mode on the transport", async () => {
  let captured: NormalizedLlmCallOptions | null = null;
  const transport: LlmTransport = {
    async invoke(input) {
      return buildResponse(input);
    },
    async *stream(input): AsyncIterable<LlmStreamEvent> {
      captured = input;
      yield { type: "delta", delta: "hel" };
      yield { type: "completed", text: "hello" };
    },
  };

  const runtime = createLlmRuntime(transport);
  const events: LlmStreamEvent[] = [];
  for await (const event of runtime.stream({
    providerId: "openai",
    model: "gpt-5.4",
    messages: [{ role: "user", content: "stream me" }],
    jsonMode: false,
  })) {
    events.push(event);
  }

  assert.notEqual(captured, null);
  assert.equal(captured?.stream, true);
  assert.deepEqual(events, [
    { type: "delta", delta: "hel" },
    { type: "completed", text: "hello" },
  ]);
});

test("runtime.invoke rejects stream=true to keep the API explicit", async () => {
  const transport: LlmTransport = {
    async invoke(input) {
      return buildResponse(input);
    },
    async *stream(): AsyncIterable<LlmStreamEvent> {
      yield { type: "completed", text: "unused" };
    },
  };

  const runtime = createLlmRuntime(transport);
  await assert.rejects(
    runtime.invoke({
      providerId: "openai",
      model: "gpt-5.4",
      messages: [{ role: "user", content: "should fail" }],
      stream: true,
    }),
    /use runtime\.stream instead/,
  );
});
