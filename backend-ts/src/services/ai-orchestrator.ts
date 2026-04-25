import type { LlmRuntime, LlmStreamEvent } from "../llm/index.ts";
import { OpenAIResponsesTransport, createLlmRuntime } from "../llm/index.ts";
import { type ComplexityAnalyzer, createComplexityAnalyzer } from "./complexity-analyzer.ts";
import { resolveExecutionRouting } from "./execution-routing-service.ts";
import { LightweightMemoryStore } from "./lightweight-memory-store.ts";
import { buildPromptRegistry, type PromptTemplate } from "./prompt-registry.ts";
import {
  assessRetrievalConfidence,
  buildLowConfidencePayload,
} from "./retrieval-confidence.ts";
import {
  OpenAIEmbeddingVectorizer,
  createRetrievalEngine,
  type EmbeddingVectorizer,
  type RetrievalEngine,
} from "../retrieval/index.ts";
import { createOpenAIApiClient } from "./openai-api-client.ts";
import type {
  AiSourceGroups,
  AiSourceV1Message,
  AiSourceV1Request,
  AiSourceV1Response,
} from "../../../shared/ai-source-v1.ts";
import type { ComplexitySelection, ExecutionRoutingDecision, ModelSelection } from "./execution-routing-service.ts";

export interface SessionCookiePayload {
  readonly name: string;
  readonly value: string;
  readonly maxAge: number;
  readonly httpOnly: boolean;
  readonly sameSite: "lax";
}

export interface AiRuntimeRequest {
  readonly body: AiSourceV1Request;
  readonly cookies?: Readonly<Record<string, string>>;
}

export interface AiComputeResult {
  readonly payload: AiSourceV1Response;
  readonly sessionCookie: SessionCookiePayload;
}

export interface AiStreamExecution {
  readonly sessionCookie: SessionCookiePayload;
  readonly chunks: AsyncIterable<string>;
  readonly completed: Promise<void>;
}

export interface AiRuntime {
  compute(request: AiRuntimeRequest): Promise<AiComputeResult>;
  openStream(request: AiRuntimeRequest): Promise<AiStreamExecution>;
}

interface AiOrchestratorDependencies {
  readonly llmRuntime: LlmRuntime;
  readonly complexityAnalyzer: ComplexityAnalyzer;
  readonly retriever: RetrievalEngine;
  readonly memoryStore: LightweightMemoryStore;
  readonly prompts: Record<string, PromptTemplate>;
}

interface PreparedRequestContext {
  readonly providerId: string;
  readonly role: string;
  readonly userMessage: string;
  readonly description: unknown;
  readonly history: unknown;
  readonly sources: AiSourceGroups | null;
  readonly memoryEvent: Record<string, unknown> | null;
  readonly sessionId: string;
  readonly modelSelection: ModelSelection | undefined;
  readonly complexitySelection: ComplexitySelection | undefined;
}

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || "nc_session_id";
const SESSION_COOKIE_MAX_AGE = Number(process.env.SESSION_COOKIE_MAX_AGE ?? 7 * 24 * 60 * 60);
const PROVIDERS = new Set(["openai"]);
const STRUCTURED_REPAIR_MIN_OUTPUT_TOKENS = 4000;

function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function buildSessionCookie(sessionId: string): SessionCookiePayload {
  return {
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    maxAge: SESSION_COOKIE_MAX_AGE,
    httpOnly: false,
    sameSite: "lax",
  };
}

function resolveSessionId(
  request: AiRuntimeRequest,
): string {
  const cookieSessionId = request.cookies?.[SESSION_COOKIE_NAME];
  const bodySessionId = request.body.session_id?.trim();
  if (bodySessionId) {
    return bodySessionId;
  }
  if (cookieSessionId?.trim()) {
    return cookieSessionId.trim();
  }
  return crypto.randomUUID();
}

function ensureProvider(providerId: string): string {
  if (!PROVIDERS.has(providerId)) {
    throw new Error(`provider ${providerId} is not supported in the TS runtime`);
  }
  return providerId;
}

function mergeSessionHistory(history: unknown, sessionMemory: { recent_history?: unknown[] }): unknown {
  if (history && (!(Array.isArray(history)) || history.length > 0)) {
    return history;
  }
  const recentHistory = sessionMemory.recent_history ?? [];
  return recentHistory.length > 0 ? recentHistory : history;
}

function mergeEpisodicResults(
  ncResults: readonly Record<string, unknown>[],
  episodicHits: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of [...episodicHits, ...ncResults]) {
    const identity = String(item.doc ?? item.chunk_id ?? "");
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push({ ...item });
  }
  return merged;
}

function persistValidatedMemoryEvent(
  memoryStore: LightweightMemoryStore,
  memoryEvent: Record<string, unknown> | null,
  context: {
    readonly sessionId: string;
    readonly role: string;
    readonly label: string | null;
    readonly description: unknown;
    readonly responseText: string | null;
    readonly sources: AiSourceGroups | null;
  },
): boolean {
  if (!memoryEvent || memoryEvent.type !== "validated_output") {
    return false;
  }

  const summary = String(memoryEvent.summary ?? context.responseText ?? "").trim();
  if (!summary) {
    return false;
  }

  return memoryStore.writeValidatedEpisode({
    episodeId: String(memoryEvent.episode_id ?? `${context.sessionId}:${context.role}:${Date.now()}`),
    caseRef: memoryEvent.case_ref ? String(memoryEvent.case_ref) : null,
    role: context.role,
    label: String(memoryEvent.label ?? context.label ?? ""),
    summary,
    corrections: memoryEvent.corrections ?? context.description,
    sources: context.sources,
    validated: memoryEvent.validated !== false,
    supersedes: memoryEvent.supersedes ? String(memoryEvent.supersedes) : null,
  });
}

function formatSearchResults(results: readonly Record<string, unknown>[]): { readonly sources: readonly Record<string, unknown>[] } {
  return { sources: results };
}

function normalizeSources(input: unknown): AiSourceGroups | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const techDocs = record.tech_docs;
  const nonConformities = record.non_conformities;
  if (!techDocs || !nonConformities) {
    return null;
  }
  return {
    tech_docs: techDocs as AiSourceGroups["tech_docs"],
    non_conformities: nonConformities as AiSourceGroups["non_conformities"],
    ...(record.entities_wiki
      ? { entities_wiki: record.entities_wiki as AiSourceGroups["entities_wiki"] }
      : {}),
  };
}

function sseEncode(event: string | null, data: unknown): string {
  const payload = typeof data === "string" ? JSON.stringify(data) : JSON.stringify(data);
  return event ? `event: ${event}\ndata: ${payload}\n\n` : `data: ${payload}\n\n`;
}

function parseFinalPayload(responseText: string): {
  readonly text: string | null;
  readonly label: string | null;
  readonly description: Record<string, unknown> | string | null;
} {
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    const label = typeof parsed.label === "string" ? parsed.label : null;
    const description =
      typeof parsed.description === "string" || (parsed.description && typeof parsed.description === "object")
        ? (parsed.description as Record<string, unknown> | string)
        : null;
    const comment = typeof parsed.comment === "string" ? parsed.comment : null;

    return {
      text: comment ?? (label || description ? null : responseText),
      label,
      description,
    };
  } catch {
    return {
      text: responseText,
      label: null,
      description: null,
    };
  }
}

function needsStructuredRepair(
  prompt: PromptTemplate | undefined,
  finalPayload: {
    readonly text: string | null;
    readonly label: string | null;
    readonly description: Record<string, unknown> | string | null;
  },
): boolean {
  if (!prompt?.jsonMode) {
    return false;
  }

  return !finalPayload.label && finalPayload.description == null;
}

function buildResponsePayload(
  context: PreparedRequestContext,
  finalPayload: {
    readonly text: string | null;
    readonly label: string | null;
    readonly description: Record<string, unknown> | string | null;
  },
  sources: AiSourceGroups,
): AiSourceV1Response {
  return {
    text: finalPayload.text,
    label: finalPayload.label,
    description: finalPayload.description,
    sources,
    user_query: context.userMessage,
    input_description:
      typeof context.description === "string" || context.description == null
        ? (context.description as string | null)
        : jsonStringify(context.description),
    role: "ai",
    user_role: context.role,
  };
}

function normalizeSourceV1Payload(payload: AiSourceV1Response): AiSourceV1Response {
  return {
    ...payload,
    input_description:
      typeof payload.input_description === "string" || payload.input_description == null
        ? payload.input_description
        : jsonStringify(payload.input_description),
  };
}

export class NativeAiOrchestrator implements AiRuntime {
  readonly #llmRuntime: LlmRuntime;
  readonly #complexityAnalyzer: ComplexityAnalyzer;
  readonly #retriever: RetrievalEngine;
  readonly #memoryStore: LightweightMemoryStore;
  readonly #prompts: Record<string, PromptTemplate>;

  constructor(dependencies: AiOrchestratorDependencies) {
    this.#llmRuntime = dependencies.llmRuntime;
    this.#complexityAnalyzer = dependencies.complexityAnalyzer;
    this.#retriever = dependencies.retriever;
    this.#memoryStore = dependencies.memoryStore;
    this.#prompts = dependencies.prompts;
  }

  async #runPrompt(
    promptName: string,
    variables: Record<string, unknown>,
    routingInput: {
      readonly stage: "search_rewrite" | "assistant_response";
      readonly role: string;
      readonly userMessage: string;
      readonly description?: string | null;
      readonly historyExcerpt?: string | null;
      readonly retrievalConfidence?: "low" | "medium" | "high";
    },
    providerId: string,
    options: { readonly stream?: boolean } = {},
  ): Promise<{
    readonly routing: ExecutionRoutingDecision;
    readonly routingReasons: readonly string[];
    readonly reasoningSummary: string | null;
    readonly text: string;
    readonly stream?: AsyncIterable<LlmStreamEvent>;
  }> {
    const prompt = this.#prompts[promptName];
    if (!prompt) {
      throw new Error(`prompt ${promptName} not found`);
    }
    const rendered = prompt.render(variables);
    const routing = await resolveExecutionRouting(
      {
        stage: routingInput.stage,
        userRole: routingInput.role,
        userMessage: routingInput.userMessage,
        description: routingInput.description,
        historyExcerpt: routingInput.historyExcerpt,
        retrievalConfidence: routingInput.retrievalConfidence,
        modelSelection:
          routingInput.stage === "assistant_response" ? variables.modelSelection as ModelSelection | undefined : undefined,
        complexitySelection:
          routingInput.stage === "assistant_response" ? variables.complexitySelection as ComplexitySelection | undefined : undefined,
      },
      this.#complexityAnalyzer,
    );

    const messages = [];
    if (rendered.system) {
      messages.push({ role: "system" as const, content: rendered.system });
    }
    messages.push({ role: "user" as const, content: rendered.user });

    if (options.stream) {
      return {
        routing,
        routingReasons: routing.reasons,
        reasoningSummary: null,
        text: "",
        stream: this.#llmRuntime.stream({
          providerId,
          model: routing.resolvedModel,
          messages,
          reasoning: { effort: routing.resolvedReasoningEffort },
          jsonMode: prompt.jsonMode,
          maxOutputTokens: routing.profile.maxOutputTokens,
          stream: true,
        }),
      };
    }

    const response = await this.#llmRuntime.invoke({
      providerId,
      model: routing.resolvedModel,
      messages,
      reasoning: { effort: routing.resolvedReasoningEffort },
      jsonMode: prompt.jsonMode,
      maxOutputTokens: routing.profile.maxOutputTokens,
    });
    return {
      routing,
      routingReasons: routing.reasons,
      reasoningSummary: response.reasoningSummary,
      text: response.text,
    };
  }

  async #repairStructuredPrompt(
    promptName: string,
    variables: Record<string, unknown>,
    providerId: string,
    resolvedModel: RuntimeModel,
    maxOutputTokens: number,
  ): Promise<{
    readonly payload: {
      readonly text: string | null;
      readonly label: string | null;
      readonly description: Record<string, unknown> | string | null;
    };
    readonly responseText: string;
  } | null> {
    const prompt = this.#prompts[promptName];
    if (!prompt?.jsonMode) {
      return null;
    }

    const rendered = prompt.render(variables);
    const messages = [];
    if (rendered.system) {
      messages.push({ role: "system" as const, content: rendered.system });
    }
    messages.push({ role: "user" as const, content: rendered.user });

    const repaired = await this.#llmRuntime.invoke({
      providerId,
      model: resolvedModel,
      messages,
      reasoning: { effort: null },
      jsonMode: true,
      maxOutputTokens: Math.max(maxOutputTokens, STRUCTURED_REPAIR_MIN_OUTPUT_TOKENS),
    });

    return {
      payload: parseFinalPayload(repaired.text),
      responseText: repaired.text,
    };
  }

  #prepareRequest(request: AiRuntimeRequest): PreparedRequestContext {
    const lastMessage = request.body.messages.at(-1);
    if (!lastMessage) {
      throw new Error("messages field required");
    }

    const providerId = ensureProvider(request.body.provider?.trim() || "openai");
    return {
      providerId,
      role: String(lastMessage.role ?? "000"),
      userMessage: String(lastMessage.text ?? ""),
      description: (lastMessage as AiSourceV1Message).description ?? "",
      history: (lastMessage as AiSourceV1Message).history ?? [],
      sources: normalizeSources((lastMessage as AiSourceV1Message).sources),
      memoryEvent: request.body.memory_event ?? null,
      sessionId: resolveSessionId(request),
      modelSelection: request.body.modelSelection,
      complexitySelection: request.body.complexitySelection,
    };
  }

  async #resolveSources(context: PreparedRequestContext): Promise<{
    readonly sources: AiSourceGroups;
    readonly query: string | null;
    readonly retrievalConfidence: "low" | "medium" | "high";
  }> {
    if (context.sources) {
      return {
        sources: context.sources,
        query: null,
        retrievalConfidence: "high",
      };
    }

    const sessionMemory = this.#memoryStore.readWorkingMemory(context.sessionId);
    const mergedHistory = mergeSessionHistory(context.history, sessionMemory);
    const queryResult = await this.#runPrompt(
      "query",
      {
        role: context.role,
        user_message: context.userMessage,
        description: context.description,
      },
      {
        stage: "search_rewrite",
        role: context.role,
        userMessage: context.userMessage,
        description:
          typeof context.description === "string" ? context.description : jsonStringify(context.description),
      },
      context.providerId,
    );
    const query = queryResult.text;
    const retrieval = await this.#retriever.search(query);
    const episodicHits = this.#memoryStore.searchEpisodicMemory(query, 3);
    const mergedNcResults = mergeEpisodicResults(retrieval.nonConformities, episodicHits);
    const sources: AiSourceGroups = {
      tech_docs: formatSearchResults([...retrieval.techDocs]),
      non_conformities: formatSearchResults(mergedNcResults),
      entities_wiki: formatSearchResults([...retrieval.entitiesWiki]),
    };
    const confidence = assessRetrievalConfidence(
      [...retrieval.techDocs],
      mergedNcResults,
    );

    return {
      sources,
      query,
      retrievalConfidence: confidence.level,
    };
  }

  async compute(request: AiRuntimeRequest): Promise<AiComputeResult> {
    const context = this.#prepareRequest(request);
    const sessionMemory = this.#memoryStore.readWorkingMemory(context.sessionId);
    const history = mergeSessionHistory(context.history, sessionMemory);
    const { sources, query, retrievalConfidence } = await this.#resolveSources(context);

    if (!context.sources && retrievalConfidence === "low") {
      const cautiousPayload = normalizeSourceV1Payload(buildLowConfidencePayload({
        role: context.role,
        userMessage: context.userMessage,
        description: context.description,
        sources,
        confidence: {
          level: "low",
          signals: [],
          reason: "low retrieval confidence",
        },
      }) as AiSourceV1Response);
      this.#memoryStore.rememberWorkingMemory({
        sessionId: context.sessionId,
        role: context.role,
        userMessage: context.userMessage,
        searchQuery: query,
        label: cautiousPayload.label,
        description: cautiousPayload.description,
        responseText: cautiousPayload.text,
        sources,
      });
      return {
        payload: cautiousPayload,
        sessionCookie: buildSessionCookie(context.sessionId),
      };
    }

    const finalPromptVariables = {
      role: context.role,
      user_message: context.userMessage,
      description: context.description,
      search_docs: jsonStringify(sources.tech_docs),
      search_nc: jsonStringify(sources.non_conformities),
      search_entities_wiki: jsonStringify(sources.entities_wiki),
      history: jsonStringify(history),
      modelSelection: context.modelSelection,
      complexitySelection: context.complexitySelection,
    };

    const finalResult = await this.#runPrompt(
      context.role,
      finalPromptVariables,
      {
        stage: "assistant_response",
        role: context.role,
        userMessage: context.userMessage,
        description:
          typeof context.description === "string" ? context.description : jsonStringify(context.description),
        historyExcerpt: jsonStringify(history),
        retrievalConfidence,
      },
      context.providerId,
    );

    let finalPayload = parseFinalPayload(finalResult.text);
    if (needsStructuredRepair(this.#prompts[context.role], finalPayload)) {
      const repaired = await this.#repairStructuredPrompt(
        context.role,
        finalPromptVariables,
        context.providerId,
        finalResult.routing.resolvedModel,
        finalResult.routing.profile.maxOutputTokens,
      );
      if (repaired && !needsStructuredRepair(this.#prompts[context.role], repaired.payload)) {
        finalPayload = repaired.payload;
      }
    }
    const responsePayload = buildResponsePayload(context, finalPayload, sources);
    this.#memoryStore.rememberWorkingMemory({
      sessionId: context.sessionId,
      role: context.role,
      userMessage: context.userMessage,
      searchQuery: query,
      label: responsePayload.label,
      description: responsePayload.description,
      responseText: responsePayload.text,
      sources,
    });
    persistValidatedMemoryEvent(this.#memoryStore, context.memoryEvent, {
      sessionId: context.sessionId,
      role: context.role,
      label: responsePayload.label,
      description: responsePayload.description,
      responseText: responsePayload.text,
      sources,
    });

    return {
      payload: responsePayload,
      sessionCookie: buildSessionCookie(context.sessionId),
    };
  }

  async openStream(request: AiRuntimeRequest): Promise<AiStreamExecution> {
    const context = this.#prepareRequest(request);
    const sessionMemory = this.#memoryStore.readWorkingMemory(context.sessionId);
    const history = mergeSessionHistory(context.history, sessionMemory);
    const self = this;

    const chunks = {
      async *[Symbol.asyncIterator](): AsyncIterator<string> {
        yield sseEncode("delta_encoding", "v1");
        yield sseEncode("status", { state: "started" });

        let query: string | null = null;
        let sources = context.sources;
        let retrievalConfidence: "low" | "medium" | "high" = "high";

        if (!sources) {
          yield sseEncode("tool_call_start", {
            tool_call_id: "query",
            name: "query_builder",
            args: context.userMessage,
          });
          yield sseEncode(null, {
            type: "action",
            text: "Build appropriate request",
            metadata: "query",
          });

          const queryResult = await self.#runPrompt(
            "query",
            {
              role: context.role,
              user_message: context.userMessage,
              description: context.description,
            },
            {
              stage: "search_rewrite",
              role: context.role,
              userMessage: context.userMessage,
              description:
                typeof context.description === "string"
                  ? context.description
                  : jsonStringify(context.description),
            },
            context.providerId,
          );
          query = queryResult.text;
          yield sseEncode("tool_call_result", {
            tool_call_id: "query",
            result: {
              status: "completed",
              summary: query,
            },
          });
          yield sseEncode(null, {
            type: "result",
            text: query,
            metadata: "query",
          });

          yield sseEncode("tool_call_start", {
            tool_call_id: "doc_search",
            name: "search_tech_docs",
            args: query,
          });
          yield sseEncode(null, {
            type: "action",
            text: "Search for relevant technical documents",
            metadata: "doc_search",
          });
          const retrieval = await self.#retriever.search(query);
          yield sseEncode("tool_call_result", {
            tool_call_id: "doc_search",
            result: {
              status: "completed",
              summary: `${retrieval.techDocs.length} source${retrieval.techDocs.length === 1 ? "" : "s"}`,
            },
          });
          yield sseEncode(null, {
            type: "result",
            text: formatSearchResults([...retrieval.techDocs]),
            metadata: "doc_search",
          });

          yield sseEncode("tool_call_start", {
            tool_call_id: "nc_search",
            name: "search_non_conformities",
            args: query,
          });
          yield sseEncode(null, {
            type: "action",
            text: "Search for similar non-conformities",
            metadata: "nc_search",
          });
          const episodicHits = self.#memoryStore.searchEpisodicMemory(query, 3);
          const mergedNcResults = mergeEpisodicResults(retrieval.nonConformities, episodicHits);
          yield sseEncode("tool_call_result", {
            tool_call_id: "nc_search",
            result: {
              status: "completed",
              summary: `${mergedNcResults.length} source${mergedNcResults.length === 1 ? "" : "s"}`,
            },
          });
          yield sseEncode(null, {
            type: "result",
            text: formatSearchResults(mergedNcResults),
            metadata: "nc_search",
          });

          yield sseEncode("tool_call_start", {
            tool_call_id: "wiki_search",
            name: "search_entities_wiki",
            args: query,
          });
          yield sseEncode(null, {
            type: "action",
            text: "Search for relevant entities and wiki articles",
            metadata: "wiki_search",
          });
          yield sseEncode("tool_call_result", {
            tool_call_id: "wiki_search",
            result: {
              status: "completed",
              summary: `${retrieval.entitiesWiki.length} source${retrieval.entitiesWiki.length === 1 ? "" : "s"}`,
            },
          });
          yield sseEncode(null, {
            type: "result",
            text: formatSearchResults([...retrieval.entitiesWiki]),
            metadata: "wiki_search",
          });

          sources = {
            tech_docs: formatSearchResults([...retrieval.techDocs]),
            non_conformities: formatSearchResults(mergedNcResults),
            entities_wiki: formatSearchResults([...retrieval.entitiesWiki]),
          };
          retrievalConfidence = assessRetrievalConfidence(
            [...retrieval.techDocs],
            mergedNcResults,
          ).level;

          if (retrievalConfidence === "low") {
            yield sseEncode(null, {
              type: "action",
              text: "Generate cautious answer",
              metadata: context.role,
            });
            const cautiousPayload = normalizeSourceV1Payload(buildLowConfidencePayload({
              role: context.role,
              userMessage: context.userMessage,
              description: context.description,
              sources,
              confidence: {
                level: "low",
                signals: [],
                reason: "low retrieval confidence",
              },
            }) as AiSourceV1Response);
            self.#memoryStore.rememberWorkingMemory({
              sessionId: context.sessionId,
              role: context.role,
              userMessage: context.userMessage,
              searchQuery: query,
              label: cautiousPayload.label,
              description: cautiousPayload.description,
              responseText: cautiousPayload.text,
              sources,
            });
            yield sseEncode(null, {
              type: "result",
              text: cautiousPayload,
              metadata: "final",
            });
            return;
          }
        }

        const activeSources = sources ?? {
          tech_docs: { sources: [] },
          non_conformities: { sources: [] },
          entities_wiki: { sources: [] },
        };

        yield sseEncode("status", {
          state: "reasoning_effort_selected",
          requestedModelSelection: context.modelSelection ?? "gpt-5.4-nano",
          requestedComplexitySelection: context.complexitySelection ?? "auto",
        });
        yield sseEncode(null, {
          type: "action",
          text: "Generate final answer",
          metadata: context.role,
        });

        const finalPromptVariables = {
          role: context.role,
          user_message: context.userMessage,
          description: context.description,
          search_docs: jsonStringify(activeSources.tech_docs),
          search_nc: jsonStringify(activeSources.non_conformities),
          search_entities_wiki: jsonStringify(activeSources.entities_wiki),
          history: jsonStringify(history),
          modelSelection: context.modelSelection,
          complexitySelection: context.complexitySelection,
        };

        const finalResult = await self.#runPrompt(
          context.role,
          finalPromptVariables,
          {
            stage: "assistant_response",
            role: context.role,
            userMessage: context.userMessage,
            description:
              typeof context.description === "string"
                ? context.description
                : jsonStringify(context.description),
            historyExcerpt: jsonStringify(history),
            retrievalConfidence,
          },
          context.providerId,
          { stream: true },
        );

        yield sseEncode("status", {
          state: "reasoning_effort_selected",
          requestedModelSelection: finalResult.routing.requestedModelSelection,
          requestedComplexitySelection: finalResult.routing.requestedComplexitySelection,
          resolvedModel: finalResult.routing.resolvedModel,
          resolvedComplexity: finalResult.routing.resolvedComplexity,
          reasoningEffort: finalResult.routing.resolvedReasoningEffort,
          modelSelectionSource: finalResult.routing.modelSelectionSource,
          complexitySource: finalResult.routing.complexitySource,
        });

        let fullResponseText = "";
        for await (const event of finalResult.stream ?? []) {
          if (event.type === "delta" && event.delta) {
            fullResponseText += event.delta;
            yield sseEncode("content_delta", {
              delta: event.delta,
            });
            yield sseEncode("delta", {
              v: event.delta,
              metadata: context.role,
            });
          }
          if (event.type === "completed" && event.text) {
            fullResponseText = event.text;
            if (event.reasoningSummary) {
              yield sseEncode("reasoning_delta", {
                delta: event.reasoningSummary,
              });
            }
          }
        }

        let parsed = parseFinalPayload(fullResponseText);
        if (needsStructuredRepair(self.#prompts[context.role], parsed)) {
          yield sseEncode("status", {
            state: "repairing_structured_response",
            metadata: context.role,
          });
          yield sseEncode(null, {
            type: "action",
            text: "Repair final structured answer",
            metadata: context.role,
          });
          const repaired = await self.#repairStructuredPrompt(
            context.role,
            finalPromptVariables,
            context.providerId,
            finalResult.routing.resolvedModel,
            finalResult.routing.profile.maxOutputTokens,
          );
          if (repaired && !needsStructuredRepair(self.#prompts[context.role], repaired.payload)) {
            fullResponseText = repaired.responseText;
            parsed = repaired.payload;
          }
        }
        const responsePayload = buildResponsePayload(context, parsed, activeSources);
        self.#memoryStore.rememberWorkingMemory({
          sessionId: context.sessionId,
          role: context.role,
          userMessage: context.userMessage,
          searchQuery: query,
          label: responsePayload.label,
          description: responsePayload.description,
          responseText: responsePayload.text,
          sources: activeSources,
        });
        persistValidatedMemoryEvent(self.#memoryStore, context.memoryEvent, {
          sessionId: context.sessionId,
          role: context.role,
          label: responsePayload.label,
          description: responsePayload.description,
          responseText: responsePayload.text,
          sources: activeSources,
        });
        yield sseEncode(null, {
          type: "result",
          text: responsePayload,
          metadata: "final",
        });
        yield sseEncode("done", {
          status: "completed",
        });
      },
    };

    return {
      sessionCookie: buildSessionCookie(context.sessionId),
      chunks,
      completed: Promise.resolve(),
    };
  }
}

let defaultRuntime: AiRuntime | null = null;

export function createDefaultAiRuntime(
  options: {
    readonly llmRuntime?: LlmRuntime;
    readonly complexityAnalyzer?: ComplexityAnalyzer;
    readonly vectorizer?: EmbeddingVectorizer;
    readonly retriever?: RetrievalEngine;
    readonly memoryStore?: LightweightMemoryStore;
    readonly prompts?: Record<string, PromptTemplate>;
  } = {},
): AiRuntime {
  const client = createOpenAIApiClient();
  const llmRuntime =
    options.llmRuntime ?? createLlmRuntime(new OpenAIResponsesTransport(client));
  const vectorizer =
    options.vectorizer ?? new OpenAIEmbeddingVectorizer(client);
  const retriever = options.retriever ?? createRetrievalEngine(vectorizer);
  const memoryStore = options.memoryStore ?? new LightweightMemoryStore();
  const prompts = options.prompts ?? buildPromptRegistry();
  const complexityAnalyzer =
    options.complexityAnalyzer ?? createComplexityAnalyzer(llmRuntime);

  return new NativeAiOrchestrator({
    llmRuntime,
    complexityAnalyzer,
    retriever,
    memoryStore,
    prompts,
  });
}

export function getDefaultAiRuntime(): AiRuntime {
  if (!defaultRuntime) {
    defaultRuntime = createDefaultAiRuntime();
  }
  return defaultRuntime;
}
