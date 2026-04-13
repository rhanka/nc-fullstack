import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenAIResponsesRequest,
  OpenAIResponsesTransport,
  type OpenAIResponsesApiClient,
  type OpenAIResponsesCreateRequest,
  type OpenAIResponsesStreamEvent,
} from "../src/llm/index.ts";

const BASE_OPTIONS = {
  providerId: "openai",
  model: "gpt-5.4",
  messages: [
    { role: "developer", content: "You are a precise NC assistant." },
    { role: "user", content: "Summarize the discrepancy." },
  ],
  reasoning: { effort: "high" as const },
  jsonMode: false,
  stream: false,
  maxOutputTokens: 1024,
};

test("buildOpenAIResponsesRequest maps reasoning, json mode and max tokens", () => {
  const request = buildOpenAIResponsesRequest({
    ...BASE_OPTIONS,
    jsonMode: true,
  });

  assert.deepEqual(request, {
    model: "gpt-5.4",
    input: [
      { role: "developer", content: "You are a precise NC assistant." },
      { role: "user", content: "Summarize the discrepancy." },
    ],
    reasoning: {
      effort: "high",
      summary: "auto",
    },
    text: {
      format: {
        type: "json_object",
      },
    },
    max_output_tokens: 1024,
  });
});

test("OpenAIResponsesTransport.invoke maps a Responses API payload to the internal response", async () => {
  let capturedRequest: OpenAIResponsesCreateRequest | null = null;
  const client: OpenAIResponsesApiClient = {
    responses: {
      async create(request) {
        capturedRequest = request;
        return {
          id: "resp_non_stream",
          model: "gpt-5.4",
          output_text: "Final NC answer",
          output: [
            {
              type: "reasoning",
              summary: [{ type: "summary_text", text: "Cross-checked two candidate sources." }],
            },
          ],
        };
      },
      async *stream(): AsyncIterable<OpenAIResponsesStreamEvent> {
        yield { type: "response.completed", response: { id: "unused", model: "gpt-5.4" } };
      },
    },
  };

  const transport = new OpenAIResponsesTransport(client);
  const response = await transport.invoke(BASE_OPTIONS);

  assert.notEqual(capturedRequest, null);
  assert.equal(capturedRequest?.reasoning?.summary, "auto");
  assert.equal(capturedRequest?.text?.format.type, "text");
  assert.equal(response.text, "Final NC answer");
  assert.equal(response.responseId, "resp_non_stream");
  assert.equal(response.reasoningSummary, "Cross-checked two candidate sources.");
});

test("OpenAIResponsesTransport.stream maps delta and completed events", async () => {
  let capturedRequest: OpenAIResponsesCreateRequest | null = null;
  const client: OpenAIResponsesApiClient = {
    responses: {
      async create() {
        throw new Error("create should not be called in stream test");
      },
      async *stream(request): AsyncIterable<OpenAIResponsesStreamEvent> {
        capturedRequest = request;
        yield { type: "response.output_text.delta", delta: "Final " };
        yield { type: "response.output_text.delta", delta: "answer" };
        yield { type: "response.output_text.done", text: "Final answer" };
        yield {
          type: "response.completed",
          response: {
            id: "resp_stream",
            model: "gpt-5.4",
            output_text: "Final answer",
            output: [
              {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "Expanded because retrieval confidence was low." }],
              },
            ],
          },
        };
      },
    },
  };

  const transport = new OpenAIResponsesTransport(client);
  const events = [];
  for await (const event of transport.stream({ ...BASE_OPTIONS, stream: true })) {
    events.push(event);
  }

  assert.notEqual(capturedRequest, null);
  assert.equal(capturedRequest?.reasoning?.summary, "auto");
  assert.deepEqual(events, [
    { type: "delta", delta: "Final " },
    { type: "delta", delta: "answer" },
    {
      type: "completed",
      text: "Final answer",
      responseId: "resp_stream",
      reasoningSummary: "Expanded because retrieval confidence was low.",
    },
  ]);
});
