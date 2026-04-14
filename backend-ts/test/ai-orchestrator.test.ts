import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NativeAiOrchestrator, type AiRuntimeRequest } from "../src/services/ai-orchestrator.ts";
import type { LlmRuntime, LlmStreamEvent } from "../src/llm/index.ts";
import type { ComplexityAnalyzer } from "../src/services/complexity-analyzer.ts";
import { LightweightMemoryStore } from "../src/services/lightweight-memory-store.ts";
import type { PromptTemplate } from "../src/services/prompt-registry.ts";
import type { HybridRetriever } from "../src/retrieval/hybrid-retriever.ts";

function createPrompt(system: string, user: string, jsonMode: boolean): PromptTemplate {
  return {
    legacyLlmId: "",
    systemTemplate: system,
    userTemplate: user,
    inputNames: [],
    temperature: 0,
    jsonMode,
    render(variables: Record<string, unknown>) {
      const toValue = (value: unknown) =>
        value == null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value);

      let renderedSystem = system;
      let renderedUser = user;
      for (const [key, value] of Object.entries(variables)) {
        renderedSystem = renderedSystem.replaceAll(`{{${key}}}`, toValue(value));
        renderedUser = renderedUser.replaceAll(`{{${key}}}`, toValue(value));
      }
      return { system: renderedSystem, user: renderedUser };
    },
  } as PromptTemplate;
}

function createDependencies() {
  const llmRuntime: LlmRuntime = {
    async invoke(options) {
      const system = options.messages[0]?.content ?? "";
      if (system.includes("QUERY-PROMPT")) {
        return {
          providerId: "openai",
          model: options.model,
          text: "ATA 56 windshield frame rivet flushness",
          jsonMode: false,
          responseId: "query-1",
          reasoningSummary: null,
        };
      }

      return {
        providerId: "openai",
        model: options.model,
        text: JSON.stringify({
          label: "Windshield rivet flushness out of tolerance",
          description: {
            observation: "Measured rivet flushness below tolerance on right windshield frame.",
          },
          comment: "Draft updated with similar cases and technical references.",
        }),
        jsonMode: true,
        responseId: "final-1",
        reasoningSummary: "Cross-checked technical docs and one similar NC.",
      };
    },
    stream(options) {
      const system = options.messages[0]?.content ?? "";
      if (system.includes("QUERY-PROMPT")) {
        throw new Error("query prompt should not stream in this test");
      }

      const events: LlmStreamEvent[] = [
        {
          type: "delta",
          delta: "{\"label\":\"Windshield rivet flushness out of tolerance\",",
        },
        {
          type: "delta",
          delta: "\"description\":{\"observation\":\"Measured rivet flushness below tolerance on right windshield frame.\"},\"comment\":\"Draft updated with similar cases and technical references.\"}",
        },
        {
          type: "completed",
          text: JSON.stringify({
            label: "Windshield rivet flushness out of tolerance",
            description: {
              observation: "Measured rivet flushness below tolerance on right windshield frame.",
            },
            comment: "Draft updated with similar cases and technical references.",
          }),
          responseId: "final-stream-1",
          reasoningSummary: "Cross-checked technical docs and one similar NC.",
        },
      ];

      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };
    },
  };

  const complexityAnalyzer: ComplexityAnalyzer = {
    async analyze() {
      return {
        level: "standard",
        analyzerModel: "gpt-5.4-nano",
        promptVersion: "complexity-eval-v1",
        rawOutput: "standard",
      };
    },
  };

  const retriever = {
    async search(query: string) {
      assert.match(query, /ATA 56/u);
      return {
        techDocs: [
          {
            doc: "tech-window.md",
            chunk_id: "tech-window",
            content: "Window frame flushness limits and repair references.",
            retrieval_channels: ["lexical", "vector"],
            rrf_score: 0.04,
            vector_distance: 0.82,
            retrieval_rank: 1,
          },
        ],
        nonConformities: [
          {
            doc: "ATA-56-2024-0001",
            chunk_id: "ATA-56-2024-0001",
            content: "Similar rivet flushness deviation on windshield frame.",
            retrieval_channels: ["lexical", "vector"],
            rrf_score: 0.035,
            vector_distance: 0.88,
            retrieval_rank: 1,
          },
        ],
        debug: {
          techDocs: {
            corpus: "tech_docs",
            vectorEnabled: true,
            queryVariants: [query],
          },
          nonConformities: {
            corpus: "non_conformities",
            vectorEnabled: true,
            queryVariants: [query],
          },
        },
      };
    },
  } as unknown as HybridRetriever;

  const prompts: Record<string, PromptTemplate> = {
    query: createPrompt("QUERY-PROMPT", "query for {{description}} / {{user_message}}", false),
    "000": createPrompt(
      "FINAL-PROMPT-000",
      "final for {{description}} / {{search_docs}} / {{search_nc}}",
      true,
    ),
  };

  const memoryStore = new LightweightMemoryStore(
    path.join(mkdtempSync(path.join(os.tmpdir(), "nc-ai-orchestrator-")), "memory.sqlite3"),
  );

  return {
    llmRuntime,
    complexityAnalyzer,
    retriever,
    prompts,
    memoryStore,
  };
}

function buildRequest(): AiRuntimeRequest {
  return {
    body: {
      provider: "openai",
      messages: [
        {
          role: "000",
          text: "Rewrite the report using the most relevant references.",
          description: "Right windshield frame rivet flushness out of tolerance.",
          history: [],
        },
      ],
    },
    cookies: {},
  };
}

test("NativeAiOrchestrator.compute returns a source-v1 payload without Python runtime", async () => {
  const orchestrator = new NativeAiOrchestrator(createDependencies());

  const result = await orchestrator.compute(buildRequest());

  assert.match(result.sessionCookie.value, /^[0-9a-f-]{36}$/u);
  assert.equal(result.payload.role, "ai");
  assert.equal(result.payload.user_role, "000");
  assert.equal(result.payload.label, "Windshield rivet flushness out of tolerance");
  assert.equal(result.payload.sources.tech_docs?.sources?.[0]?.doc, "tech-window.md");
  assert.equal(
    result.payload.sources.non_conformities?.sources?.[0]?.doc,
    "ATA-56-2024-0001",
  );
});

test("NativeAiOrchestrator.openStream emits legacy SSE blocks without Python runtime", async () => {
  const orchestrator = new NativeAiOrchestrator(createDependencies());

  const execution = await orchestrator.openStream(buildRequest());
  const chunks: string[] = [];
  for await (const chunk of execution.chunks) {
    chunks.push(chunk);
  }

  assert.match(chunks[0] ?? "", /event: delta_encoding/u);
  assert.ok(chunks.some((chunk) => chunk.includes('"metadata":"query"')));
  assert.ok(chunks.some((chunk) => chunk.includes('"metadata":"doc_search"')));
  assert.ok(chunks.some((chunk) => chunk.includes('"metadata":"nc_search"')));
  assert.ok(chunks.some((chunk) => chunk.includes('event: delta')));
  assert.ok(chunks.some((chunk) => chunk.includes("event: status")));
  assert.ok(chunks.some((chunk) => chunk.includes("event: tool_call_start")));
  assert.ok(chunks.some((chunk) => chunk.includes("event: tool_call_result")));
  assert.ok(chunks.some((chunk) => chunk.includes("event: reasoning_delta")));
  assert.ok(chunks.some((chunk) => chunk.includes("event: content_delta")));
  assert.ok(chunks.some((chunk) => chunk.includes('"metadata":"final"')));
  await execution.completed;
});
