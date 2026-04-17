<script lang="ts">
  import { marked } from "marked";
  import type { UIMessage } from "@ai-sdk/svelte";
  import { parsePartialJson } from "@ai-sdk/ui-utils";
  import Icon from "@iconify/svelte";
  import { afterUpdate, onMount, tick } from "svelte";
  import { getApiBaseUrl } from "$lib/api-base";
  import {
    normalizeLegacyFinalPayload,
    type LegacyFinalPayload,
    type LegacySources,
  } from "$lib/chat/legacy-payload";
  import { chatLayoutMode } from "$lib/chat/layout";
  import {
    isUpdating,
    referencesList,
    chatElementRef,
    showChatbot,
  } from "$lib/chat/stores";
  import type {
    ChatController,
    ChatComplexitySelection,
    ChatModelSelection,
    ChatSubmitArgs,
    ReferenceSourceItem,
    ReferenceSources,
  } from "$lib/chat/contracts";

  import {
    TASK_IDS,
    activeTabValue,
    createdItem,
    selectDoc,
    selectEntity,
    taskLabel,
    updateCreatedItem,
  } from "./store";

  type RuntimeStep = {
    key: string;
    kind: "tool" | "status" | "reasoning";
    status: "running" | "completed" | "error";
    title: string;
    detail?: string;
  };

  type AssistantRuntime = {
    requestId: string | null;
    status: "submitted" | "streaming" | "ready" | "error";
    stateTitle: string;
    stateDetail: string;
    requestedModel: ChatModelSelection;
    requestedComplexity: ChatComplexitySelection;
    resolvedModel: ChatModelSelection | null;
    resolvedComplexity: ChatComplexitySelection | null;
    resolvedReasoningEffort: "none" | "minimal" | "low" | "high" | "xhigh" | null;
    reasoningSummary: string;
    steps: RuntimeStep[];
  };

  type ReasoningSummaryPart = {
    type: "reasoning_summary";
    summary: string;
  };

  type SourcesPart = {
    type: "sources";
    sources: LegacySources;
  };

  type NcUpdatePart = {
    type: "nc_update";
    role?: string | null;
    label?: string | null;
    description?: unknown;
  };

  type TextPart = {
    type: "text";
    text: string;
  };

  type StructuredMessagePart = TextPart | ReasoningSummaryPart | SourcesPart | NcUpdatePart;

  type ChatMessage = UIMessage;

  type IntroQuickAction = {
    label: string;
    prompt?: string | (() => string);
    run?: () => void | Promise<void>;
  };

  type EntitySourceItem = ReferenceSourceItem & {
    readonly slug?: unknown;
    readonly title?: unknown;
    readonly path?: unknown;
    readonly ata_codes?: unknown;
    readonly zones?: unknown;
    readonly aliases?: unknown;
    readonly part_numbers?: unknown;
    readonly supporting_docs?: unknown;
    readonly primary_doc?: unknown;
    readonly wiki_rank?: unknown;
    readonly wiki_score?: unknown;
  };
  type StructuredAssistantPayload = LegacyFinalPayload & {
    reasoningSummary?: string;
  };

  type PartialStructuredPayload = {
    label?: unknown;
    description?: unknown;
    comment?: unknown;
  };

  type LegacyStreamPayload = {
    type?: string;
    metadata?: string;
    text?: unknown;
    v?: unknown;
  };

  type RuntimeStatusPayload = {
    state?: string;
    requestedModelSelection?: ChatModelSelection;
    requestedComplexitySelection?: ChatComplexitySelection;
    resolvedModel?: ChatModelSelection;
    resolvedComplexity?: ChatComplexitySelection;
    reasoningEffort?: AssistantRuntime["resolvedReasoningEffort"];
  };

  type ToolRuntimePayload = {
    tool_call_id?: string;
    name?: string;
    args?: string;
    result?: {
      status?: "completed" | "error" | string;
      summary?: string;
      error?: string;
    };
  };

  const randomNonConformityDescriptions = [
      "Description du Problème :\nLors du contrôle de qualité du numéro d’avion MSN 0070, une non-conformité a été identifiée concernant le perçage d'une série de rivets sur le revêtement extérieur, sous la glace du pare-brise droit. Un désaffleurement a été mesuré entre -0,20 mm et -0,25 mm, dépassant les tolérances spécifiées dans les normes d'assemblage.\nDétails Techniques :\n•       Localisation : Zone en dessous du pare-brise droit\n•       Mesure de Désaffleurement : -0,20 mm à -0,25 mm\n•       Norme Acceptable : Tolérance maximale de -0,10 mm selon la spécification interne (Réf. SP-2023-078)",
      "Description du Problème :\nLors des tests de débit effectués sur le réservoir principal de l'aile gauche du numéro d’avion 0070, une non-conformité a été identifiée : un débit faible a été mesuré au niveau de la crépine d’aspiration. Ce problème pourrait compromettre l'alimentation en carburant et nécessite une investigation approfondie pour évaluer les causes et les impacts.\nDétails Techniques :\n•       Localisation : Réservoir principal aile gauche.\n•       Problème identifié : Débit faible de la crépine d'aspiration.\n•       Norme Acceptable : Débit minimum requis selon la spécification interne (Réf. SP-2023-101).",
      "Description du Problème :\nLors de l'inspection des systèmes de décharge électrostatique du numéro d’avion 0070, une non-conformité a été détectée concernant la conductivité des fils de décharge électrostatique entre le tuyau et la structure au niveau du réservoir secondaire de l’aile droite. Les tests ont révélé des valeurs de conductivité supérieures aux tolérances spécifiées, ce qui pourrait compromettre l'efficacité du système.\nDétails Techniques :\n•       Localisation : Réservoir secondaire aile droite.\n•       Problème identifié : Conductivité des fils de décharge électrostatique non conforme.\n•       Norme Acceptable : Conductivité requise selon la spécification interne (Réf. SP-2023-115).",
      "Description du Problème :\nLors d’un contrôle qualité sur le numéro d’avion 0070, une non-conformité a été identifiée : une rayure de 10 cm de long et 0,1 cm de profondeur a été observée sur une structure en aluminium dans la zone C2-2. Ce défaut soulève des préoccupations concernant le risque potentiel de corrosion, nécessitant la validation d’un expert pour évaluer l'impact sur l'intégrité structurelle.\nDétails Techniques :\n•       Localisation : Zone C2-2, structure en aluminium.\n•       Dimensions de la Rayure : 10 cm de long, 0,1 cm de profondeur.\n•       Norme Acceptable : Aucun défaut de surface n'est toléré selon les spécifications (Réf. SP-2023-092)."
  ];

  const aiUrl = `${getApiBaseUrl()}/ai`;
  const runtimeStageOrder = [
    "query",
    "doc_search",
    "nc_search",
    "wiki_search",
    "000",
    "100",
    "200",
    "300",
    "400",
    "500",
    "final",
  ];
  const modelOptions: Array<{ value: ChatModelSelection; label: string }> = [
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    { value: "gpt-5.4", label: "GPT-5.4" },
  ];
  const complexityOptions: Array<{ value: ChatComplexitySelection; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "simple", label: "Light" },
    { value: "standard", label: "Standard" },
    { value: "deep", label: "Deep" },
  ];

  export let expand = false;
  export let height = "70vh";
  export let width = "25rem";

  let windowInnerWidth: number | undefined = undefined;
  let dynamicWidth = width;
  let dynamicHeight = height;
  let messageViewport: HTMLElement | null = null;
  let activeRequestId: string | null = null;
  let activeAssistantMessageId: string | null = null;
  let composerInput = "";
  let composerTextarea: HTMLTextAreaElement | null = null;
  let composerIsMultiline = false;
  let chatMessages: ChatMessage[] = [];
  let chatStatus: "submitted" | "streaming" | "ready" | "error" = "ready";
  let chatError: Error | undefined = undefined;
  let assistantRuntimeByMessageId: Record<string, AssistantRuntime> = {};
  let streamAbortController: AbortController | null = null;
  let lastOptimisticUpdateSignature = "";
  let modelSelection: ChatModelSelection = "gpt-5.4-nano";
  let complexitySelection: ChatComplexitySelection = "auto";
  let demoModeModalOpen = false;
  let demoModePrompted = false;
  let demoModeTimer: number | null = null;
  let demoModeOpenedChat = false;
  let reportDescriptionTypingRun = 0;

  $: dynamicWidth =
    windowInnerWidth !== undefined && windowInnerWidth <= 768
      ? "100dvw"
      : width;
  $: dynamicHeight =
    windowInnerWidth !== undefined && windowInnerWidth <= 768
      ? `calc(100dvh - ${expand ? 21.5 : 11.5}rem)`
      : height;

  function clearDemoModeTimer() {
    if (demoModeTimer !== null) {
      window.clearTimeout(demoModeTimer);
      demoModeTimer = null;
    }
  }

  function isBlankOrPlaceholder(value: unknown, placeholder: string) {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== "string") {
      return false;
    }

    const normalizedValue = value.trim();
    return normalizedValue === "" || normalizedValue === placeholder;
  }

  function isDemoReportPristine() {
    const history = $createdItem?.analysis_history ?? {};
    const hasLaterTaskContent = TASK_IDS
      .filter((task) => task !== "000")
      .some((task) => (history[task] ?? []).length > 0);

    if (hasLaterTaskContent) {
      return false;
    }

    const steps = history["000"] ?? [];
    if (steps.length === 0) {
      return true;
    }

    if (steps.length > 1) {
      return false;
    }

    const step = steps[0] ?? {};
    return (
      isBlankOrPlaceholder(step.label, "<Label for non-conformity report>") &&
      isBlankOrPlaceholder(
        step.description,
        "Please provide a concise and precise description for this task",
      ) &&
      !step.validated &&
      !step.feedback &&
      !step.undo &&
      !step.redo
    );
  }

  function isDemoModeCandidate() {
    return (
      getCurrentTaskRole() === "000" &&
      isDemoReportPristine() &&
      chatMessages.length === 0 &&
      composerInput.trim().length === 0 &&
      chatStatus === "ready"
    );
  }

  afterUpdate(() => {
    if (messageViewport) {
      messageViewport.scrollTop = messageViewport.scrollHeight;
    }
  });

  $: if (typeof window !== "undefined") {
    const shouldScheduleDemoMode = isDemoModeCandidate() && !demoModePrompted && !demoModeModalOpen;

    if (shouldScheduleDemoMode && demoModeTimer === null) {
      demoModeTimer = window.setTimeout(() => {
        demoModeTimer = null;
        if (isDemoModeCandidate() && !demoModePrompted) {
          demoModeOpenedChat = !$showChatbot;
          $showChatbot = true;
          demoModePrompted = true;
          demoModeModalOpen = true;
        }
      }, 15000);
    }

    if (!shouldScheduleDemoMode && demoModeTimer !== null) {
      clearDemoModeTimer();
    }
  }

  onMount(() => {
    windowInnerWidth = window.innerWidth;

    const controller: ChatController = {
      clearMessages,
      setDraftInput,
      submitUserMessage,
    };

    chatElementRef.set(controller);
    void tick().then(updateComposerHeight);

    return () => {
      streamAbortController?.abort();
      clearDemoModeTimer();
      if ($chatElementRef === controller) {
        chatElementRef.set(null);
      }
    };
  });

  function cloneData<T>(value: T | null | undefined | ""): T | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }

  function buildHistory(currentTask: string) {
    return TASK_IDS
      .filter((task) => task < currentTask)
      .map((task) => $createdItem?.analysis_history?.[task] ?? []);
  }

  function buildTaskContext() {
    const currentTask = $createdItem?.currentTask ?? "000";

    return {
      currentTask,
      description: $createdItem?.analysis_history?.[currentTask]?.[0],
      history: buildHistory(currentTask),
      sources: undefined,
    };
  }

  function beginChatRequest(messageId: string) {
    activeRequestId = globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`;
    activeAssistantMessageId = messageId;
    chatError = undefined;
    lastOptimisticUpdateSignature = "";
    assistantRuntimeByMessageId = {
      ...assistantRuntimeByMessageId,
      [messageId]: {
        requestId: activeRequestId,
        status: "submitted",
        stateTitle: "Request sent",
        stateDetail: "Preparing the assistant response.",
        requestedModel: modelSelection,
        requestedComplexity: complexitySelection,
        resolvedModel: null,
        resolvedComplexity: null,
        resolvedReasoningEffort: null,
        reasoningSummary: buildPendingReasoningSummary(modelSelection, complexitySelection),
        steps: [],
      },
    };
  }

  function createChatMessage(role: "user" | "assistant", text = ""): ChatMessage {
    const parts: StructuredMessagePart[] = role === "assistant" && text
      ? [{ type: "text", text }]
      : [];

    return {
      id: globalThis.crypto?.randomUUID?.() ?? `${role}-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      role,
      content: text,
      parts,
    } as ChatMessage;
  }

  function applyLegacyResponse(payload: StructuredAssistantPayload, taskRole: string) {
    if (payload.sources) {
      referencesList.set(payload.sources as ReferenceSources);
    }

    if (payload.label || payload.description) {
      updateCreatedItem.set({
        role: taskRole,
        label: payload.label ?? undefined,
        description: payload.description,
      });
    }

    isUpdating.set(false);
  }

  function buildAssistantParts(
    payload: StructuredAssistantPayload,
    taskRole?: string,
  ): StructuredMessagePart[] {
    const parts: StructuredMessagePart[] = [];

    if (payload.reasoningSummary) {
      parts.push({
        type: "reasoning_summary",
        summary: payload.reasoningSummary,
      });
    }

    if (payload.sources) {
      parts.push({
        type: "sources",
        sources: payload.sources,
      });
    }

    if (payload.label || payload.description) {
      parts.push({
        type: "nc_update",
        role: taskRole ?? null,
        label: payload.label,
        description: payload.description,
      });
    }

    return parts;
  }

  function enrichAssistantMessage(
    messageId: string,
    payload: StructuredAssistantPayload,
    taskRole?: string,
  ) {
    chatMessages = chatMessages.map((message): ChatMessage => {
      if (message.id !== messageId) {
        return message;
      }

      const preservedParts = ((message.parts ?? []) as StructuredMessagePart[]).filter(
        (part) => part.type === "text",
      );

      return {
        ...message,
        parts: [...preservedParts, ...buildAssistantParts(payload, taskRole)],
      } as unknown as ChatMessage;
    });
  }

  function appendChatMessage(message: ChatMessage) {
    chatMessages = [...chatMessages, message];
  }

  function replaceAssistantText(messageId: string, text: string) {
    chatMessages = chatMessages.map((message): ChatMessage => {
      if (message.id !== messageId) {
        return message;
      }

      const structuredParts = ((message.parts ?? []) as StructuredMessagePart[]).filter(
        (part) => part.type !== "text",
      );

      return {
        ...message,
        content: text,
        parts: text ? [{ type: "text", text }, ...structuredParts] : structuredParts,
      } as unknown as ChatMessage;
    });
  }

  function setAssistantReasoningSummary(messageId: string, summary: string | undefined) {
    chatMessages = chatMessages.map((message): ChatMessage => {
      if (message.id !== messageId) {
        return message;
      }

      const preservedParts = ((message.parts ?? []) as StructuredMessagePart[]).filter(
        (part) => part.type !== "reasoning_summary",
      );

      return {
        ...message,
        parts: summary
          ? [...preservedParts, { type: "reasoning_summary", summary }]
          : preservedParts,
      } as unknown as ChatMessage;
    });

    updateAssistantRuntime(messageId, (runtime) => ({
      ...runtime,
      reasoningSummary: summary ?? runtime.reasoningSummary,
    }));
  }

  function humanizeComplexitySelection(value: ChatComplexitySelection | null | undefined) {
    if (!value) {
      return null;
    }
    switch (value) {
      case "auto":
        return "Auto";
      case "simple":
        return "Light";
      case "standard":
        return "Standard";
      case "deep":
        return "Deep";
      default:
        return value;
    }
  }

  function humanizeReasoningEffort(
    value: AssistantRuntime["resolvedReasoningEffort"],
  ) {
    if (!value) {
      return null;
    }
    switch (value) {
      case "none":
        return "No reasoning";
      case "minimal":
        return "Minimal effort";
      case "low":
        return "Low effort";
      case "high":
        return "High effort";
      case "xhigh":
        return "Max effort";
      default:
        return value;
    }
  }

  function buildPendingReasoningSummary(
    requestedModel: ChatModelSelection,
    requestedComplexity: ChatComplexitySelection,
  ) {
    const complexityLabel = humanizeComplexitySelection(requestedComplexity);
    return complexityLabel
      ? `${requestedModel} selected with ${complexityLabel.toLowerCase()} effort.`
      : `${requestedModel} selected for this draft.`;
  }

  function updateAssistantRuntime(
    messageId: string,
    updater: (runtime: AssistantRuntime) => AssistantRuntime,
  ) {
    const runtime = assistantRuntimeByMessageId[messageId];
    if (!runtime) {
      return;
    }

    assistantRuntimeByMessageId = {
      ...assistantRuntimeByMessageId,
      [messageId]: updater(runtime),
    };
  }

  function setAssistantRuntimeState(
    messageId: string,
    status: AssistantRuntime["status"],
    stateTitle: string,
    stateDetail = "",
  ) {
    updateAssistantRuntime(messageId, (runtime) => ({
      ...runtime,
      status,
      stateTitle,
      stateDetail,
    }));
  }

  function upsertAssistantRuntimeStep(messageId: string, step: RuntimeStep) {
    updateAssistantRuntime(messageId, (runtime) => {
      const steps = runtime.steps.filter((entry) => entry.key !== step.key);
      steps.push(step);
      steps.sort((left, right) => {
        const leftIndex = runtimeStageOrder.indexOf(left.key);
        const rightIndex = runtimeStageOrder.indexOf(right.key);
        return leftIndex - rightIndex;
      });

      return {
        ...runtime,
        steps,
      };
    });
  }

  function setAssistantRuntimeRouting(
    messageId: string,
    payload: RuntimeStatusPayload,
  ) {
    updateAssistantRuntime(messageId, (runtime) => {
      const resolvedModel = payload.resolvedModel ?? runtime.resolvedModel;
      const resolvedComplexity = payload.resolvedComplexity ?? runtime.resolvedComplexity;
      const resolvedReasoningEffort =
        payload.reasoningEffort ?? runtime.resolvedReasoningEffort;
      const requestedModel = payload.requestedModelSelection ?? runtime.requestedModel;
      const requestedComplexity =
        payload.requestedComplexitySelection ?? runtime.requestedComplexity;

      const reasoningFragments = [
        resolvedModel ? `${resolvedModel} in use.` : `${requestedModel} requested.`,
        resolvedComplexity ? `${humanizeComplexitySelection(resolvedComplexity)} selected.` : null,
        resolvedReasoningEffort
          ? `${humanizeReasoningEffort(resolvedReasoningEffort)} applied.`
          : null,
      ].filter(Boolean);

      return {
        ...runtime,
        requestedModel,
        requestedComplexity,
        resolvedModel,
        resolvedComplexity,
        resolvedReasoningEffort,
        reasoningSummary:
          reasoningFragments.join(" ") || runtime.reasoningSummary,
      };
    });
  }

  function appendAssistantRuntimeReasoning(messageId: string, summary: string) {
    if (!summary.trim()) {
      return;
    }

    updateAssistantRuntime(messageId, (runtime) => ({
      ...runtime,
      reasoningSummary: summary.trim(),
    }));
    upsertAssistantRuntimeStep(messageId, {
      key: "reasoning",
      kind: "reasoning",
      status: "completed",
      title: "Reasoning summary",
      detail: summary.trim(),
    });
  }

  function getAssistantRuntime(messageId: string): AssistantRuntime | null {
    return assistantRuntimeByMessageId[messageId] ?? null;
  }

  function getMessageText(message: UIMessage): string {
    const textParts = ((message.parts ?? []) as unknown as StructuredMessagePart[]).filter(
      (part): part is TextPart => part.type === "text",
    );
    return textParts.length
      ? textParts.map((part) => part.text).join("")
      : message.content;
  }

  function getRuntimeBadges(runtime: AssistantRuntime): string[] {
    const badges: string[] = [runtime.resolvedModel ?? runtime.requestedModel];
    const complexityLabel =
      humanizeComplexitySelection(runtime.resolvedComplexity ?? runtime.requestedComplexity);
    if (complexityLabel) {
      badges.push(complexityLabel);
    }
    const effortLabel = humanizeReasoningEffort(runtime.resolvedReasoningEffort);
    if (effortLabel) {
      badges.push(effortLabel);
    }
    return badges;
  }

  function getRuntimeCompactMeta(runtime: AssistantRuntime) {
    const toolCount = runtime.steps.filter((step) => step.kind === "tool").length;
    const fragments: string[] = [];

    if (runtime.reasoningSummary.trim()) {
      fragments.push(runtime.status === "ready" ? "Reasoning available" : "Thinking");
    }

    if (toolCount > 0) {
      fragments.push(`${toolCount} step${toolCount === 1 ? "" : "s"}`);
    }

    return fragments.join(" · ") || runtime.stateDetail;
  }

  function getRuntimePreview(runtime: AssistantRuntime) {
    const source = runtime.reasoningSummary.trim() || runtime.stateDetail.trim();
    if (!source) {
      return "";
    }
    return source.length > 110 ? `${source.slice(0, 109)}…` : source;
  }

  function countSources(maybeSources: unknown) {
    return isPlainObject(maybeSources) && Array.isArray(maybeSources.sources)
      ? maybeSources.sources.length
      : 0;
  }

  function summarizeLegacyResult(metadata: string, result: unknown) {
    if (metadata === "query" && typeof result === "string") {
      return result;
    }

    if (
      metadata === "doc_search" ||
      metadata === "nc_search" ||
      metadata === "wiki_search"
    ) {
      const count = countSources(result);
      return `${count} source${count > 1 ? "s" : ""}`;
    }

    return undefined;
  }

  function buildReasoningSummary(
    payload: { sources?: LegacySources },
    taskRole: string,
  ) {
    const techDocsCount = countSources(payload.sources?.tech_docs);
    const nonConformitiesCount = countSources(payload.sources?.non_conformities);
    const entitiesWikiCount = countSources(payload.sources?.entities_wiki);
    const fragments: string[] = [];

    if (techDocsCount || nonConformitiesCount || entitiesWikiCount) {
      fragments.push(
        `Built a targeted retrieval query, reviewed ${techDocsCount} technical document${techDocsCount === 1 ? "" : "s"}, ${nonConformitiesCount} similar non-conformit${nonConformitiesCount === 1 ? "y" : "ies"} and ${entitiesWikiCount} entity reference${entitiesWikiCount === 1 ? "" : "s"}.`,
      );
    }

    if (taskRole) {
      fragments.push(`Generated the task ${taskRole} draft from those references.`);
    }

    return fragments.length > 0 ? fragments.join(" ") : undefined;
  }

  function parseLegacySseBlock(block: string): { event: string | null; data: unknown } | null {
    const lines = block.split("\n");
    let event = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    const rawData = dataLines.join("\n");

    try {
      return {
        event,
        data: JSON.parse(rawData),
      };
    } catch {
      return {
        event,
        data: rawData,
      };
    }
  }

  function getPartialStructuredPayload(value: string): PartialStructuredPayload | null {
    const parsed = parsePartialJson(value).value;
    return isPlainObject(parsed) ? (parsed as PartialStructuredPayload) : null;
  }

  function decodePartialJsonString(value: string): string {
    return value
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  function extractPartialJsonStringField(rawPayload: string, field: string): string | undefined {
    const fieldToken = `"${field}"`;
    const fieldIndex = rawPayload.indexOf(fieldToken);
    if (fieldIndex === -1) {
      return undefined;
    }

    const colonIndex = rawPayload.indexOf(":", fieldIndex + fieldToken.length);
    if (colonIndex === -1) {
      return undefined;
    }

    let valueIndex = colonIndex + 1;
    while (/\s/.test(rawPayload[valueIndex] ?? "")) {
      valueIndex += 1;
    }

    if (rawPayload[valueIndex] !== "\"") {
      return undefined;
    }

    valueIndex += 1;
    let escaped = false;
    let buffer = "";

    for (; valueIndex < rawPayload.length; valueIndex += 1) {
      const char = rawPayload[valueIndex];
      if (escaped) {
        buffer += `\\${char}`;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        return decodePartialJsonString(buffer);
      }

      buffer += char;
    }

    if (!buffer.trim()) {
      return undefined;
    }

    return decodePartialJsonString(buffer);
  }

  function buildLiveStructuredPayload(rawPayload: string): PartialStructuredPayload | null {
    const label = extractPartialJsonStringField(rawPayload, "label");
    const observation = extractPartialJsonStringField(rawPayload, "observation");
    const comment = extractPartialJsonStringField(rawPayload, "comment");

    if (!label && !observation && !comment) {
      return null;
    }

    return {
      ...(label ? { label } : {}),
      ...(comment ? { comment } : {}),
      ...(observation
        ? {
            description: {
              observation,
            },
          }
        : {}),
    };
  }

  function buildPartialAssistantPreview(payload: PartialStructuredPayload): string | undefined {
    if (typeof payload.comment === "string" && payload.comment.trim()) {
      return payload.comment;
    }
    return undefined;
  }

  function buildStreamingReasoningSummary(
    taskRole: string,
    phase: "submitted" | "streaming" | "finalizing",
    hints: {
      techDocsCount?: number;
      nonConformitiesCount?: number;
      entitiesWikiCount?: number;
      usingProvidedSources?: boolean;
    } = {},
  ): string {
    if (phase === "submitted") {
      return `The request has been sent for task ${taskRole}.`;
    }

    if (phase === "streaming") {
      return hints.usingProvidedSources
        ? `Using the current task context and available references to draft the task ${taskRole} response.`
        : `Building the task ${taskRole} response from retrieval signals.`;
    }

    const techDocsCount = hints.techDocsCount ?? 0;
    const nonConformitiesCount = hints.nonConformitiesCount ?? 0;
    const entitiesWikiCount = hints.entitiesWikiCount ?? 0;
    if (techDocsCount || nonConformitiesCount || entitiesWikiCount) {
      return `Drafting the task ${taskRole} response after reviewing ${techDocsCount} technical document${techDocsCount === 1 ? "" : "s"}, ${nonConformitiesCount} similar non-conformit${nonConformitiesCount === 1 ? "y" : "ies"} and ${entitiesWikiCount} entity reference${entitiesWikiCount === 1 ? "" : "s"}.`;
    }

    return `Drafting the final task ${taskRole} response.`;
  }

  function applyOptimisticReportUpdate(taskRole: string, payload: PartialStructuredPayload) {
    const nextLabel = typeof payload.label === "string" ? payload.label : undefined;
    const nextDescription = payload.description;

    if (!nextLabel && nextDescription === undefined) {
      return;
    }

    const signature = JSON.stringify({
      role: taskRole,
      label: nextLabel ?? null,
      description: nextDescription ?? null,
    });

    if (signature === lastOptimisticUpdateSignature) {
      return;
    }

    lastOptimisticUpdateSignature = signature;
    updateCreatedItem.set({
      role: taskRole,
      label: nextLabel,
      description: cloneData(nextDescription) ?? nextDescription,
    });
  }

  function normalizeStreamResultPayload(value: unknown): LegacyFinalPayload {
    if (isPlainObject(value)) {
      return value as LegacyFinalPayload;
    }

    if (typeof value === "string") {
      return { text: value };
    }

    try {
      return { text: JSON.stringify(value) };
    } catch {
      return { text: String(value) };
    }
  }

  function getRuntimeStagePresentation(metadata: string) {
    switch (metadata) {
      case "query":
        return {
          title: "Preparing retrieval",
          detail: "Building the retrieval query from the current task context.",
        };
      case "doc_search":
        return {
          title: "Searching technical documents",
          detail: "Looking for the most relevant references.",
        };
      case "nc_search":
        return {
          title: "Searching similar non-conformities",
          detail: "Collecting comparable cases.",
        };
      case "wiki_search":
        return {
          title: "Searching entities",
          detail: "Resolving ATA, part and zone context.",
        };
      default:
        return {
          title: "Generating answer",
          detail: "Drafting the assistant response.",
        };
    }
  }

  function getToolLabel(name: string, fallbackMetadata: string) {
    switch (name) {
      case "query_builder":
        return "Build appropriate request";
      case "search_tech_docs":
      case "doc_search":
        return "Search technical documents";
      case "search_non_conformities":
      case "nc_search":
        return "Search similar non-conformities";
      case "search_entities_wiki":
      case "wiki_search":
        return "Search entities";
      default:
        return fallbackMetadata === "final" ? "Generate final answer" : "Working";
    }
  }

  function getCurrentTaskRole() {
    return $createdItem?.currentTask ?? "000";
  }

  function normalizeReportDescription(text: string) {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]*•[ \t]*/g, "\n- ")
      .replace(/(Détails Techniques\s*:)\n-/g, "$1\n\n-")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getRandomNonConformityDescription() {
    const index = Math.floor(Math.random() * randomNonConformityDescriptions.length);
    return normalizeReportDescription(
      randomNonConformityDescriptions[index] ?? randomNonConformityDescriptions[0],
    );
  }

  function sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getTypingChunkLength(text: string, position: number) {
    const nextChar = text[position];

    if (!nextChar || nextChar === "\n" || /[.,;:!?]/.test(nextChar)) {
      return 1;
    }

    const remaining = text.length - position;
    const burst = Math.random() < 0.25 ? 3 : Math.random() < 0.7 ? 2 : 1;
    return Math.min(remaining, burst);
  }

  function getTypingDelayMs(chunk: string) {
    const lastChar = chunk[chunk.length - 1] ?? "";

    if (lastChar === "\n") {
      return 140 + Math.random() * 120;
    }

    if (/[.!?]/.test(lastChar)) {
      return 160 + Math.random() * 180;
    }

    if (/[,;:]/.test(lastChar)) {
      return 90 + Math.random() * 120;
    }

    return 28 + Math.random() * 54;
  }

  function setReportDescription(text: string) {
    createdItem.update((current) => {
      const next = cloneData(current) ?? current;
      const taskRole = "000";
      const history = next.analysis_history ?? {};
      const steps = history[taskRole] ?? [];
      const currentStep = steps[0] ?? {};

      steps[0] = {
        ...currentStep,
        description: text,
      };
      history[taskRole] = steps;
      next.analysis_history = history;
      next.currentTask = taskRole;

      return next;
    });
  }

  async function typeReportDescription(text: string) {
    const typingRun = ++reportDescriptionTypingRun;
    let cursor = 0;

    setReportDescription("");

    while (cursor < text.length && typingRun === reportDescriptionTypingRun) {
      const chunkLength = getTypingChunkLength(text, cursor);
      const nextCursor = cursor + chunkLength;
      const nextText = text.slice(0, nextCursor);

      setReportDescription(nextText);
      cursor = nextCursor;
      await sleep(getTypingDelayMs(text.slice(cursor - chunkLength, cursor)));
    }

    return typingRun === reportDescriptionTypingRun;
  }

  async function fillRandomReportDescription(options: { launchAssistant?: boolean; revealReport?: boolean } = {}) {
    if (options.revealReport) {
      $showChatbot = false;
      await tick();
    }

    const completed = await typeReportDescription(getRandomNonConformityDescription());

    if (completed && options.launchAssistant) {
      $showChatbot = true;
      await tick();
      await submitUserMessage({
        role: "000",
        text: "Propose a concise and precise task description based on the current non-conformity report description.",
      });
    }
  }

  function getIntroQuickActions(taskRole: string): IntroQuickAction[] {
    if (taskRole === "100") {
      return [
        {
          label: "Propose analysis summary",
          prompt:
            "Propose a concise task 100 analysis summary based on the current non-conformity context.",
        },
        {
          label: "Translate to French",
          prompt:
            "Translate the current task content to French and preserve the technical terminology.",
        },
      ];
    }

    return [
      {
        label: "Propose task description",
        prompt:
          "Propose a concise and precise task description based on the current non-conformity context.",
      },
      {
        label: "Random non conformity description",
        run: () => fillRandomReportDescription({ launchAssistant: true }),
      },
      {
        label: "Translate to French",
        prompt:
          "Translate the current task content to French and preserve the technical terminology.",
      },
    ];
  }

  async function triggerIntroQuickAction(action: IntroQuickAction) {
    if (action.run) {
      await action.run();
      return;
    }

    const prompt = typeof action.prompt === "function" ? action.prompt() : action.prompt;
    if (!prompt) {
      return;
    }

    await submitUserMessage({ text: prompt });
  }

  function dismissDemoMode() {
    demoModePrompted = true;
    demoModeModalOpen = false;
    clearDemoModeTimer();
    if (demoModeOpenedChat) {
      $showChatbot = false;
      demoModeOpenedChat = false;
    }
  }

  async function startDemoMode() {
    const shouldCloseChatAfterStart = demoModeOpenedChat;

    demoModePrompted = true;
    demoModeModalOpen = false;
    demoModeOpenedChat = false;
    clearDemoModeTimer();

    await fillRandomReportDescription({
      launchAssistant: true,
      revealReport: shouldCloseChatAfterStart,
    });
  }

  async function consumeLegacySseResponse(
    response: Response,
    options: {
      taskRole: string;
      assistantMessageId: string;
      usingProvidedSources: boolean;
    },
  ): Promise<StructuredAssistantPayload> {
    if (!response.body) {
      throw new Error("The assistant stream is unavailable.");
    }

    const { taskRole, assistantMessageId, usingProvidedSources } = options;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let rawAssistantPayload = "";
    let finalPayload: StructuredAssistantPayload | null = null;
    let preferStructuredContentDelta = false;

    const initialReasoningSummary = buildStreamingReasoningSummary(taskRole, "submitted", {
      usingProvidedSources,
    });
    setAssistantReasoningSummary(assistantMessageId, initialReasoningSummary);
    setAssistantRuntimeState(
      assistantMessageId,
      "submitted",
      "Request sent",
      "Preparing the assistant response.",
    );

    const applyStreamingPreview = () => {
      const partialPayload =
        getPartialStructuredPayload(rawAssistantPayload) ??
        buildLiveStructuredPayload(rawAssistantPayload);
      if (!partialPayload) {
        return;
      }

      applyOptimisticReportUpdate(taskRole, partialPayload);
      const preview = buildPartialAssistantPreview(partialPayload);
      if (preview) {
        replaceAssistantText(assistantMessageId, preview);
      }
    };

    const handleParsedEvent = (parsedEvent: { event: string | null; data: unknown }) => {
      if (parsedEvent.event === "delta_encoding") {
        return;
      }

      if (
        parsedEvent.event === "delta" ||
        parsedEvent.event === "content_delta"
      ) {
        if (parsedEvent.event === "content_delta") {
          preferStructuredContentDelta = true;
        }
        if (parsedEvent.event === "delta" && preferStructuredContentDelta) {
          return;
        }

        const delta =
          parsedEvent.event === "content_delta"
            ? isPlainObject(parsedEvent.data) && typeof parsedEvent.data.delta === "string"
              ? parsedEvent.data.delta
              : null
            : isPlainObject(parsedEvent.data) && typeof parsedEvent.data.v === "string"
              ? parsedEvent.data.v
              : null;

        if (delta) {
          rawAssistantPayload += delta;
          chatStatus = "streaming";
          setAssistantRuntimeState(
            assistantMessageId,
            "streaming",
            "Generating answer",
            "The draft is streaming into the chat.",
          );
          setAssistantReasoningSummary(
            assistantMessageId,
            buildStreamingReasoningSummary(taskRole, "streaming", { usingProvidedSources }),
          );
          applyStreamingPreview();
        }
        return;
      }

      if (parsedEvent.event === "status" && isPlainObject(parsedEvent.data)) {
        const payload = parsedEvent.data as RuntimeStatusPayload;
        if (payload.state === "started") {
          setAssistantRuntimeState(
            assistantMessageId,
            "submitted",
            "Preparing assistant",
            "Initializing the request and runtime.",
          );
          return;
        }

        if (payload.state === "reasoning_effort_selected") {
          setAssistantRuntimeRouting(assistantMessageId, payload);
          upsertAssistantRuntimeStep(assistantMessageId, {
            key: "reasoning",
            kind: "reasoning",
            status: "running",
            title: "Reasoning plan selected",
            detail: [
              payload.resolvedModel ?? payload.requestedModelSelection,
              humanizeComplexitySelection(
                payload.resolvedComplexity ?? payload.requestedComplexitySelection,
              ),
              humanizeReasoningEffort(payload.reasoningEffort ?? null),
            ]
              .filter(Boolean)
              .join(" • "),
          });
        }
        return;
      }

      if (parsedEvent.event === "reasoning_delta" && isPlainObject(parsedEvent.data)) {
        const summary =
          typeof parsedEvent.data.delta === "string" ? parsedEvent.data.delta : "";
        if (summary) {
          appendAssistantRuntimeReasoning(assistantMessageId, summary);
          setAssistantReasoningSummary(assistantMessageId, summary);
        }
        return;
      }

      if (parsedEvent.event === "tool_call_start" && isPlainObject(parsedEvent.data)) {
        const payload = parsedEvent.data as ToolRuntimePayload;
        const key = payload.tool_call_id ?? payload.name ?? "tool";
        upsertAssistantRuntimeStep(assistantMessageId, {
          key,
          kind: "tool",
          status: "running",
          title: getToolLabel(payload.name ?? key, key),
          detail: payload.args,
        });
        return;
      }

      if (parsedEvent.event === "tool_call_result" && isPlainObject(parsedEvent.data)) {
        const payload = parsedEvent.data as ToolRuntimePayload;
        const key = payload.tool_call_id ?? payload.name ?? "tool";
        upsertAssistantRuntimeStep(assistantMessageId, {
          key,
          kind: "tool",
          status: payload.result?.error ? "error" : "completed",
          title: getToolLabel(payload.name ?? key, key),
          detail:
            payload.result?.error ??
            payload.result?.summary ??
            undefined,
        });
        return;
      }

      if (parsedEvent.event === "done") {
        setAssistantRuntimeState(
          assistantMessageId,
          "ready",
          "Draft ready",
          "The assistant response and report updates are available.",
        );
        return;
      }

      if (!isPlainObject(parsedEvent.data)) {
        return;
      }

      const payload = parsedEvent.data as LegacyStreamPayload;
      const metadata = typeof payload.metadata === "string" ? payload.metadata : "final";
      const messageText = typeof payload.text === "string" ? payload.text : undefined;

      if (payload.type === "error") {
        throw new Error(messageText || "The assistant stream failed.");
      }

      if (payload.type === "action") {
        chatStatus = "streaming";
        const stagePresentation = getRuntimeStagePresentation(metadata);
        upsertAssistantRuntimeStep(assistantMessageId, {
          key: metadata,
          kind: metadata === taskRole ? "status" : "tool",
          status: "running",
          title: messageText || stagePresentation.title,
          detail: undefined,
        });
        setAssistantRuntimeState(
          assistantMessageId,
          "streaming",
          stagePresentation.title,
          stagePresentation.detail,
        );

        setAssistantReasoningSummary(
          assistantMessageId,
          buildStreamingReasoningSummary(taskRole, "streaming", { usingProvidedSources }),
        );
        return;
      }

      if (payload.type !== "result") {
        return;
      }

      if (metadata === "final") {
        const normalizedPayload = normalizeLegacyFinalPayload(
          normalizeStreamResultPayload(payload.text),
        );
        finalPayload = {
          ...normalizedPayload,
          reasoningSummary:
            buildReasoningSummary(normalizedPayload, taskRole) ??
            buildStreamingReasoningSummary(taskRole, "finalizing", {
              usingProvidedSources,
              techDocsCount: countSources(normalizedPayload.sources?.tech_docs),
              nonConformitiesCount: countSources(normalizedPayload.sources?.non_conformities),
              entitiesWikiCount: countSources(normalizedPayload.sources?.entities_wiki),
            }),
        };
        appendAssistantRuntimeReasoning(
          assistantMessageId,
          finalPayload.reasoningSummary ?? buildStreamingReasoningSummary(taskRole, "finalizing"),
        );
        return;
      }

      const completedTitle =
        metadata === "query"
          ? "Request prepared"
          : metadata === "doc_search"
            ? "Technical documents retrieved"
            : metadata === "nc_search"
              ? "Similar non-conformities retrieved"
              : metadata === "wiki_search"
                ? "Entities retrieved"
              : "Step completed";

      upsertAssistantRuntimeStep(assistantMessageId, {
        key: metadata,
        kind: metadata === taskRole ? "status" : "tool",
        status: "completed",
        title: completedTitle,
        detail: summarizeLegacyResult(metadata, payload.text),
      });

      if (metadata === "query" && messageText) {
        setAssistantRuntimeState(assistantMessageId, "streaming", "Request prepared", messageText);
      }

      if (metadata === "doc_search") {
        setAssistantRuntimeState(
          assistantMessageId,
          "streaming",
          "Technical documents retrieved",
          summarizeLegacyResult(metadata, payload.text) ?? "Relevant documents found.",
        );
      }

      if (metadata === "nc_search") {
        setAssistantRuntimeState(
          assistantMessageId,
          "streaming",
          "Similar non-conformities retrieved",
          summarizeLegacyResult(metadata, payload.text) ?? "Relevant prior cases found.",
        );
      }

      if (metadata === "wiki_search") {
        setAssistantRuntimeState(
          assistantMessageId,
          "streaming",
          "Entities retrieved",
          summarizeLegacyResult(metadata, payload.text) ?? "Relevant entity pages found.",
        );
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex !== -1) {
        const block = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);
        if (block) {
          const parsedEvent = parseLegacySseBlock(block);
          if (parsedEvent) {
            handleParsedEvent(parsedEvent);
          }
        }
        boundaryIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const trailingBlock = buffer.trim();
    if (trailingBlock) {
      const parsedEvent = parseLegacySseBlock(trailingBlock);
      if (parsedEvent) {
        handleParsedEvent(parsedEvent);
      }
    }

    if (!finalPayload) {
      throw new Error("The assistant stream ended before the final payload was received.");
    }

    return finalPayload;
  }

  async function submitUserMessage({ text, role }: ChatSubmitArgs = {}) {
    const content = text?.trim();

    if (!content || chatStatus === "submitted" || chatStatus === "streaming") {
      return;
    }

    if (role) {
      $createdItem.currentTask = role as typeof $createdItem.currentTask;
    }

    const taskContext = buildTaskContext();
    const taskRole = taskContext.currentTask ?? "000";
    const assistantMessage = createChatMessage("assistant");
    const userMessage = createChatMessage("user", content);

    beginChatRequest(assistantMessage.id);
    composerInput = "";
    chatStatus = "submitted";
    void updateComposerHeight();
    appendChatMessage(userMessage);
    appendChatMessage(assistantMessage);
    setAssistantReasoningSummary(
      assistantMessage.id,
      buildStreamingReasoningSummary(taskRole, "submitted", {
        usingProvidedSources: Boolean(taskContext.sources),
      }),
    );
    isUpdating.set(taskRole);
    upsertAssistantRuntimeStep(assistantMessage.id, {
      key: taskRole,
      kind: "status",
      status: "running",
      title: "Generate final answer",
    });

    const abortController = new AbortController();
    streamAbortController = abortController;

    try {
      const response = await fetch(aiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          provider: "openai",
          modelSelection,
          complexitySelection,
          messages: [
            {
              role: taskRole,
              text: content,
              description: taskContext.description ?? "",
              history: taskContext.history ?? [],
              ...(taskContext.sources ? { sources: taskContext.sources } : {}),
            },
          ],
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "The assistant request failed.");
      }

      const enrichedPayload = await consumeLegacySseResponse(response, {
        taskRole,
        assistantMessageId: assistantMessage.id,
        usingProvidedSources: Boolean(taskContext.sources),
      });

      replaceAssistantText(assistantMessage.id, enrichedPayload.text ?? "");
      enrichAssistantMessage(assistantMessage.id, enrichedPayload, taskRole);
      applyLegacyResponse(enrichedPayload, taskRole);
      setAssistantRuntimeState(
        assistantMessage.id,
        "ready",
        "Draft ready",
        "The assistant response and report updates are available.",
      );
      upsertAssistantRuntimeStep(assistantMessage.id, {
        key: taskRole,
        kind: "status",
        status: "completed",
        title: "Draft generated",
      });
      chatStatus = "ready";
      chatError = undefined;
      activeAssistantMessageId = null;
    } catch (error) {
      if (abortController.signal.aborted) {
        chatStatus = "ready";
        chatError = undefined;
        setAssistantRuntimeState(
          assistantMessage.id,
          "ready",
          "Request stopped",
          "Generation was interrupted.",
        );
      } else {
        chatStatus = "error";
        chatError = error instanceof Error ? error : new Error(String(error));
        setAssistantRuntimeState(
          assistantMessage.id,
          "error",
          "Request failed",
          chatError.message,
        );
        upsertAssistantRuntimeStep(assistantMessage.id, {
          key: "error",
          kind: "status",
          status: "error",
          title: "Request failed",
          detail: chatError.message,
        });
      }
      activeAssistantMessageId = null;
      isUpdating.set(false);
    } finally {
      if (streamAbortController === abortController) {
        streamAbortController = null;
      }
      if (chatStatus !== "error") {
        chatStatus = "ready";
      }
    }
  }

  async function handleComposerSubmit(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    const nextInput = composerInput.trim();

    if (!nextInput) {
      return;
    }

    await submitUserMessage({ text: nextInput });
  }

  function handleComposerKeydown(event: {
    key?: string;
    shiftKey?: boolean;
    preventDefault?: () => void;
  }) {
    if (event.key === "Enter" && !event.shiftKey) {
      handleComposerSubmit(event);
    }
  }

  function clearMessages() {
    streamAbortController?.abort();
    streamAbortController = null;
    chatMessages = [];
    assistantRuntimeByMessageId = {};
    activeRequestId = null;
    activeAssistantMessageId = null;
    composerInput = "";
    chatError = undefined;
    chatStatus = "ready";
    lastOptimisticUpdateSignature = "";
    isUpdating.set(false);
    composerIsMultiline = false;
    if (composerTextarea) {
      composerTextarea.style.height = "";
    }
  }

  function stopCurrentRequest() {
    streamAbortController?.abort();
    streamAbortController = null;
    chatStatus = "ready";
    if (activeAssistantMessageId) {
      setAssistantRuntimeState(
        activeAssistantMessageId,
        "ready",
        "Request stopped",
        "Generation was interrupted.",
      );
    }
    activeAssistantMessageId = null;
    isUpdating.set(false);
  }

  function renderMarkdown(text: string | undefined) {
    return marked.parse(text ?? "") as string;
  }

  function getMessageHtml(message: UIMessage) {
    return renderMarkdown(getMessageText(message));
  }

  function getStructuredParts(message: UIMessage) {
    return ((message.parts ?? []) as unknown as StructuredMessagePart[]).filter(
      (part): part is Exclude<StructuredMessagePart, TextPart> => part.type !== "text",
    );
  }

  function getSourceGroups(part: SourcesPart) {
    return [
      {
        key: "tech_docs" as const,
        label: "Technical documents",
        items: (part.sources?.tech_docs?.sources ?? []) as ReferenceSourceItem[],
      },
      {
        key: "non_conformities" as const,
        label: "Similar non-conformities",
        items: (part.sources?.non_conformities?.sources ?? []) as ReferenceSourceItem[],
      },
      {
        key: "entities_wiki" as const,
        label: "Entities",
        items: (part.sources?.entities_wiki?.sources ?? []) as ReferenceSourceItem[],
      },
    ].filter((group) => group.items.length > 0);
  }

  function getSourceCount(part: SourcesPart) {
    return getSourceGroups(part).reduce((total, group) => total + group.items.length, 0);
  }

  function textValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function numberValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function textArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => textValue(entry))
        .filter((entry): entry is string => Boolean(entry));
    }
    const single = textValue(value);
    return single ? [single] : [];
  }

  function compactList(values: string[], limit = 3) {
    if (values.length <= limit) {
      return values.join(", ");
    }
    return values.slice(0, limit).join(", ") + " +" + String(values.length - limit) + " more";
  }

  function asEntityItem(item: ReferenceSourceItem): EntitySourceItem {
    return item as EntitySourceItem;
  }

  function getEntityTitle(item: ReferenceSourceItem) {
    const entity = asEntityItem(item);
    return (
      textValue(entity.title) ??
      textValue(entity.doc) ??
      textValue(entity.chunk_id) ??
      "Untitled entity"
    );
  }

  function getEntityRankLabel(item: ReferenceSourceItem) {
    const rank = numberValue(asEntityItem(item).wiki_rank);
    return rank ? "#" + String(rank) : null;
  }

  function getEntityPrimaryDoc(item: ReferenceSourceItem) {
    return textValue(asEntityItem(item).primary_doc);
  }

  function getEntitySupportingDocs(item: ReferenceSourceItem) {
    return textArray(asEntityItem(item).supporting_docs);
  }

  function getEntityMetadataLine(item: ReferenceSourceItem) {
    const entity = asEntityItem(item);
    const ataCodes = textArray(entity.ata_codes);
    const zones = textArray(entity.zones);
    const segments = [
      ...ataCodes.slice(0, 2),
      ...zones.slice(0, 2).map((zone) => "Zone " + zone),
    ];
    return segments.join(" / ");
  }

  function getEntityAliasLine(item: ReferenceSourceItem) {
    return compactList(textArray(asEntityItem(item).aliases), 2);
  }

  function getEntityPartNumberLine(item: ReferenceSourceItem) {
    return compactList(textArray(asEntityItem(item).part_numbers), 3);
  }

  function getEntityDocSummary(item: ReferenceSourceItem) {
    const primaryDoc = getEntityPrimaryDoc(item);
    const supportingDocs = getEntitySupportingDocs(item);
    const segments: string[] = [];
    if (primaryDoc) {
      segments.push("1 primary doc");
    }
    if (supportingDocs.length > 0) {
      segments.push(String(supportingDocs.length) + " supporting doc" + (supportingDocs.length === 1 ? "" : "s"));
    }
    return segments.join(" / ");
  }

  function openDocumentByName(doc: string | null) {
    if (!doc) {
      return;
    }
    selectDoc.set({ doc });
    activeTabValue.set(2);
  }

  function openEntityDrawer(item: ReferenceSourceItem) {
    selectEntity.set(asEntityItem(item));
    activeTabValue.set(4);
    expand = true;
  }

  function getSourceMeta(item: ReferenceSourceItem) {
    if (typeof item.chunk_id === "string" && item.chunk_id.trim()) {
      return item.chunk_id;
    }
    if (typeof item.chunk === "string" && item.chunk.trim() && item.chunk.length < 48) {
      return item.chunk;
    }
    return undefined;
  }

  function openSource(
    groupKey: "tech_docs" | "non_conformities" | "entities_wiki",
    item: ReferenceSourceItem,
  ) {
    if (groupKey === "tech_docs" && typeof item.doc === "string" && item.doc.trim()) {
      selectDoc.set({ doc: item.doc });
      activeTabValue.set(2);
      return;
    }

    if (groupKey === "entities_wiki") {
      openEntityDrawer(item);
      return;
    }

    if (groupKey === "non_conformities") {
      activeTabValue.set(3);
    }
  }

  function getTaskDisplayLabel(role: string | null | undefined) {
    if (!role) {
      return "Updated draft";
    }

    const normalizedRole = role as keyof typeof taskLabel;
    return taskLabel[normalizedRole] ?? `Task ${role}`;
  }

  function getAmendedObjectLabel(role: string | null | undefined) {
    return role === "000" ? "report" : "task";
  }

  function getAmendedObjectActionLabel(role: string | null | undefined) {
    return role === "000" ? "Open amended report" : "Open amended task";
  }

  function openAmendedTask(role: string | null | undefined) {
    if (role && TASK_IDS.includes(role as (typeof TASK_IDS)[number])) {
      createdItem.update((current) => ({
        ...current,
        currentTask: role as (typeof TASK_IDS)[number],
      }));
    }

    activeTabValue.set(1);
    showChatbot.set(false);
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function setDraftInput(text = "") {
    composerInput = text;
    void tick().then(updateComposerHeight);
  }

  function toggleLayoutMode() {
    chatLayoutMode.set($chatLayoutMode === "docked" ? "floating" : "docked");
  }

  async function updateComposerHeight() {
    await tick();
    if (!composerTextarea) {
      composerIsMultiline = false;
      return;
    }

    composerTextarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(composerTextarea.scrollHeight, 44), 176);
    composerTextarea.style.height = `${nextHeight}px`;
    composerIsMultiline = nextHeight > 52;
  }

  function handleComposerInput() {
    void updateComposerHeight();
  }
</script>

<svelte:window bind:innerWidth={windowInnerWidth} />

<main
  class="chat-shell"
  style={`width:${dynamicWidth};height:${dynamicHeight};`}
>
  <header class="chat-shell__header">
    <button
      class="chat-shell__icon-button"
      on:click={() => {
        $showChatbot = false;
      }}
      aria-label="Close chat"
    >
      <Icon icon="mdi:chevron-down" height="1.25rem" />
    </button>
    <div class="chat-shell__title">
      <strong>Non-Conformity Chatbot</strong>
    </div>
    <div class="chat-shell__header-actions">
      {#if windowInnerWidth === undefined || windowInnerWidth > 768}
        <button
          class="chat-shell__icon-button"
          on:click={toggleLayoutMode}
          aria-label={$chatLayoutMode === "docked" ? "Switch to floating chat" : "Dock chat panel"}
        >
          <Icon
            icon={$chatLayoutMode === "docked" ? "mdi:window-restore" : "mdi:dock-right"}
            height="1rem"
          />
        </button>
      {/if}
      <button
        class="chat-shell__icon-button"
        on:click={clearMessages}
        aria-label="Clear chat"
      >
        <Icon icon="mdi:trash-can-outline" height="1rem" />
      </button>
    </div>
  </header>

  <section class="chat-shell__messages" bind:this={messageViewport}>
    {#if chatMessages.length === 0}
      <div class="chat-intro">
        <h3>Ask the assistant</h3>
        <p>
          Ask about the current non-conformity to get a draft, supporting
          sources, and suggested updates.
        </p>
        <div class="chat-intro__actions">
          {#each getIntroQuickActions(getCurrentTaskRole()) as action}
            <button
              type="button"
              class="chat-intro__action"
              on:click={() => triggerIntroQuickAction(action)}
            >
              {action.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#each chatMessages as message (message.id)}
      {@const messageText = getMessageText(message)}
      <article class={`chat-message chat-message--${message.role}`}>
        {#if message.role === "assistant"}
          {@const runtime = getAssistantRuntime(message.id)}
          {#if runtime}
            <details
              class={`chat-runtime-card chat-runtime-card--${runtime.status}`}
              open={runtime.status === "error"}
            >
              <summary class="chat-runtime-card__summary">
                <div class="chat-runtime-card__summary-row">
                  <div class={`chat-runtime-card__state chat-runtime-card__state--${runtime.status}`}>
                    {#if runtime.status === "submitted" || runtime.status === "streaming"}
                      <span class="chat-runtime-card__spinner"></span>
                    {:else if runtime.status === "error"}
                      <Icon icon="mdi:alert-circle-outline" height="0.95rem" />
                    {:else}
                      <Icon icon="mdi:check-circle-outline" height="0.95rem" />
                    {/if}
                    <strong>{runtime.stateTitle}</strong>
                  </div>

                  <div class="chat-runtime-card__badges">
                    {#each getRuntimeBadges(runtime) as badge}
                      <span class="chat-runtime-card__badge">{badge}</span>
                    {/each}
                  </div>
                </div>

                {#if getRuntimeCompactMeta(runtime)}
                  <span class="chat-runtime-card__meta">{getRuntimeCompactMeta(runtime)}</span>
                {/if}

                {#if getRuntimePreview(runtime)}
                  <span class="chat-runtime-card__summary-text">{getRuntimePreview(runtime)}</span>
                {/if}
              </summary>

              <div class="chat-runtime-card__body">
                {#if runtime.reasoningSummary}
                  <div class="chat-runtime-card__reasoning">
                    <h4>Thinking</h4>
                    <p>{runtime.reasoningSummary}</p>
                  </div>
                {/if}

                {#if runtime.steps.length > 0}
                  <div class="chat-runtime-card__steps">
                    {#each runtime.steps as step (step.key)}
                      {#if step.detail}
                        <details
                          class={`chat-runtime-step chat-runtime-step--${step.status}`}
                        >
                          <summary class="chat-runtime-step__summary">
                            <div class="chat-runtime-step__title-row">
                              <span class={`chat-runtime-step__kind chat-runtime-step__kind--${step.kind}`}>
                                {#if step.kind === "tool"}
                                  <Icon icon="mdi:tools" height="0.8rem" />
                                {:else if step.kind === "reasoning"}
                                  <Icon icon="mdi:head-snowflake-outline" height="0.8rem" />
                                {:else}
                                  <Icon icon="mdi:progress-clock" height="0.8rem" />
                                {/if}
                              </span>
                              <strong>{step.title}</strong>
                              <span class={`chat-runtime-step__status chat-runtime-step__status--${step.status}`}>
                                {step.status}
                              </span>
                            </div>
                          </summary>
                          <p>{step.detail}</p>
                        </details>
                      {:else}
                        <div class={`chat-runtime-step chat-runtime-step--${step.status}`}>
                          <div class="chat-runtime-step__title-row">
                            <span class={`chat-runtime-step__kind chat-runtime-step__kind--${step.kind}`}>
                              {#if step.kind === "tool"}
                                <Icon icon="mdi:tools" height="0.8rem" />
                              {:else if step.kind === "reasoning"}
                                <Icon icon="mdi:head-snowflake-outline" height="0.8rem" />
                              {:else}
                                <Icon icon="mdi:progress-clock" height="0.8rem" />
                              {/if}
                            </span>
                            <strong>{step.title}</strong>
                            <span class={`chat-runtime-step__status chat-runtime-step__status--${step.status}`}>
                              {step.status}
                            </span>
                          </div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            </details>
          {/if}
        {/if}

        {#if message.role === "user" || messageText.trim().length > 0}
          <div class="chat-message__bubble">
            {@html getMessageHtml(message)}
          </div>
        {/if}

        {#if message.role === "assistant"}
          {#each getStructuredParts(message) as part, index (`${message.id}-${index}-${part.type}`)}
            {#if part.type === "sources"}
              <div class="chat-part">
                <details class="chat-sources">
                  <summary class="chat-sources__summary">
                    <strong>Sources</strong>
                    <span class="chat-sources__count">{getSourceCount(part)}</span>
                  </summary>

                  <div class="chat-sources__body">
                    {#each getSourceGroups(part) as sourceGroup}
                      <details class="chat-sources__group">
                        <summary class="chat-sources__group-summary">
                          <span>{sourceGroup.label}</span>
                          <span class="chat-sources__count">{sourceGroup.items.length}</span>
                        </summary>

                        {#if sourceGroup.key === "entities_wiki"}
                          <div class="chat-entity-cards">
                            {#each sourceGroup.items as item}
                              <article class="chat-entity-card">
                                <button
                                  type="button"
                                  class="chat-entity-card__main"
                                  title={typeof item.content === "string" ? item.content : getEntityTitle(item)}
                                  on:click={() => openEntityDrawer(item)}
                                >
                                  <span class="chat-entity-card__header">
                                    <strong>{getEntityTitle(item)}</strong>
                                    {#if getEntityRankLabel(item)}
                                      <span class="chat-entity-card__rank">{getEntityRankLabel(item)}</span>
                                    {/if}
                                  </span>
                                  <span class="chat-entity-card__kind">Entity / part</span>
                                  {#if getEntityMetadataLine(item)}
                                    <span class="chat-entity-card__line">{getEntityMetadataLine(item)}</span>
                                  {/if}
                                  {#if getEntityAliasLine(item)}
                                    <span class="chat-entity-card__line">Alias: {getEntityAliasLine(item)}</span>
                                  {/if}
                                  {#if getEntityPartNumberLine(item)}
                                    <span class="chat-entity-card__line">Part numbers: {getEntityPartNumberLine(item)}</span>
                                  {/if}
                                  {#if getEntityDocSummary(item)}
                                    <span class="chat-entity-card__line chat-entity-card__docs">{getEntityDocSummary(item)}</span>
                                  {/if}
                                </button>
                                <div class="chat-entity-card__actions">
                                  <button
                                    type="button"
                                    class="chat-entity-card__action"
                                    on:click={() => openEntityDrawer(item)}
                                  >
                                    Open entity
                                  </button>
                                  {#if getEntityPrimaryDoc(item)}
                                    <button
                                      type="button"
                                      class="chat-entity-card__action"
                                      on:click={() => openDocumentByName(getEntityPrimaryDoc(item))}
                                    >
                                      Open primary document
                                    </button>
                                  {/if}
                                </div>
                              </article>
                            {/each}
                          </div>
                        {:else}
                          <div class="chat-sources__chips">
                            {#each sourceGroup.items as item}
                              <button
                                type="button"
                                class="chat-source-chip"
                                title={typeof item.content === "string" ? item.content : item.doc ?? ""}
                                on:click={() => openSource(sourceGroup.key, item)}
                              >
                                <span class="chat-source-chip__doc">{item.doc}</span>
                                {#if getSourceMeta(item)}
                                  <span class="chat-source-chip__meta">{getSourceMeta(item)}</span>
                                {/if}
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </details>
                    {/each}
                  </div>
                </details>
              </div>
            {:else if part.type === "nc_update"}
              <div class="chat-part">
                <details class="chat-update-link">
                  <summary class="chat-update-link__summary">
                    <strong>Updated {getAmendedObjectLabel(part.role)}</strong>
                    <span class="chat-update-link__task">{getTaskDisplayLabel(part.role)}</span>
                  </summary>
                  <div class="chat-update-link__body">
                    {#if part.label}
                      <p class="chat-update-link__label">{part.label}</p>
                    {/if}
                    <button
                      type="button"
                      class="chat-update-link__button"
                      on:click={() => openAmendedTask(part.role)}
                    >
                      {getAmendedObjectActionLabel(part.role)}
                    </button>
                  </div>
                </details>
              </div>
            {/if}
          {/each}
        {/if}
      </article>
    {/each}
  </section>

  {#if chatError}
    <div class="chat-shell__error">
      {chatError.message}
    </div>
  {/if}

  {#if demoModeModalOpen}
    <div class="demo-mode-modal__backdrop" role="presentation">
      <div
        class="demo-mode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-mode-title"
        tabindex="-1"
      >
        <p class="demo-mode-modal__eyebrow">Demo mode</p>
        <h3 id="demo-mode-title">Start with a random non-conformity?</h3>
        <p>
          Fill the report description with one of the sample problem descriptions,
          then launch the assistant once the simulated typing is complete.
        </p>
        <div class="demo-mode-modal__actions">
          <button type="button" class="demo-mode-modal__secondary" on:click={dismissDemoMode}>
            Not now
          </button>
          <button type="button" class="demo-mode-modal__primary" on:click={startDemoMode}>
            Start demo
          </button>
        </div>
      </div>
    </div>
  {/if}

  <form class="chat-composer" on:submit={handleComposerSubmit}>
    <div class={`chat-composer__surface ${composerIsMultiline ? "chat-composer__surface--multiline" : ""}`}>
      <textarea
        bind:value={composerInput}
        bind:this={composerTextarea}
        class="chat-composer__input"
        placeholder="Ask your question"
        rows="1"
        on:keydown={handleComposerKeydown}
        on:input={handleComposerInput}
        disabled={chatStatus === "submitted" || chatStatus === "streaming"}
      ></textarea>

      <div class="chat-composer__footer">
        <div class="chat-composer__selectors">
          <label class="chat-composer__select-wrap">
            <span class="chat-composer__sr-only">Model</span>
            <select bind:value={modelSelection} class="chat-composer__select" aria-label="Model">
              {#each modelOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>

          <label class="chat-composer__select-wrap chat-composer__select-wrap--compact">
            <span class="chat-composer__sr-only">Reasoning effort</span>
            <select
              bind:value={complexitySelection}
              class="chat-composer__select"
              aria-label="Reasoning effort"
            >
              {#each complexityOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="chat-composer__actions">
          {#if chatStatus === "submitted" || chatStatus === "streaming"}
            <button
              type="button"
              class="chat-composer__primary chat-composer__primary--stop"
              on:click={stopCurrentRequest}
              aria-label="Stop generation"
            >
              <Icon icon="mdi:stop" height="0.95rem" />
            </button>
          {:else}
            <button
              type="submit"
              class="chat-composer__primary"
              aria-label="Send message"
            >
              <Icon icon="mdi:send" height="0.95rem" />
            </button>
          {/if}
        </div>
      </div>
    </div>
  </form>
</main>

<style>
  .chat-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border-radius: 1.1rem;
    overflow: hidden;
    box-shadow:
      0 18px 48px rgba(15, 23, 42, 0.16),
      0 2px 10px rgba(15, 23, 42, 0.08);
    border: 1px solid rgba(15, 23, 42, 0.08);
  }

  .chat-shell__header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    background: rgba(248, 250, 252, 0.94);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(14px);
  }

  .chat-shell__title {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .chat-shell__title span {
    font-size: 0.72rem;
    color: #667085;
  }

  .chat-shell__header-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
  }

  .chat-shell__icon-button {
    cursor: pointer;
    border: none;
    background: none;
    padding: 0.15rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #344054;
  }

  .chat-shell__messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.9rem 0.8rem;
    background:
      radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 24%),
      linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  }

  .chat-intro {
    padding: 0.9rem 1rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.2);
    text-align: left;
  }

  .chat-intro h3 {
    margin: 0 0 0.35rem;
    font-size: 0.95rem;
  }

  .chat-intro p {
    margin: 0;
    color: #475467;
    line-height: 1.5;
    font-size: 0.88rem;
  }

  .chat-intro__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-top: 0.8rem;
  }

  .chat-intro__action {
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: #fff;
    color: #1f2937;
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    font: inherit;
    font-size: 0.84rem;
    cursor: pointer;
  }

  .demo-mode-modal__backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(1rem, 4vw, 3rem);
    background: rgba(15, 23, 42, 0.32);
    backdrop-filter: blur(5px);
  }

  .demo-mode-modal {
    width: min(92vw, 34rem);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
    padding: 1rem;
    color: #101828;
  }

  .demo-mode-modal__eyebrow {
    margin: 0 0 0.25rem;
    color: #2563eb;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .demo-mode-modal h3 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.3;
  }

  .demo-mode-modal p {
    margin: 0.55rem 0 0;
    color: #475467;
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .demo-mode-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .demo-mode-modal__secondary,
  .demo-mode-modal__primary {
    border-radius: 999px;
    padding: 0.45rem 0.75rem;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }

  .demo-mode-modal__secondary {
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: #fff;
    color: #344054;
  }

  .demo-mode-modal__primary {
    border: 1px solid rgba(37, 99, 235, 0.2);
    background: #2563eb;
    color: #fff;
  }

  .chat-composer__primary {
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1rem;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
  }

  .chat-composer__primary {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #fff;
    box-shadow: 0 10px 18px rgba(37, 99, 235, 0.18);
  }

  .chat-message {
    display: flex;
    flex-direction: column;
    margin-top: 0.75rem;
  }

  .chat-message--assistant {
    justify-content: flex-start;
  }

  .chat-message--user {
    justify-content: flex-end;
  }

  .chat-message__bubble {
    align-self: flex-start;
    max-width: min(100%, 24rem);
    padding: 0.85rem 1rem;
    border-radius: 1.1rem;
    background: rgba(255, 255, 255, 0.98);
    color: #101828;
    border: 1px solid rgba(148, 163, 184, 0.18);
    text-align: left;
    line-height: 1.5;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
  }

  .chat-message--user .chat-message__bubble {
    align-self: flex-end;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #fff;
    border-color: rgba(37, 99, 235, 0.4);
    box-shadow: 0 12px 24px rgba(37, 99, 235, 0.2);
  }

  .chat-message__bubble :global(p) {
    margin: 0;
  }

  .chat-message__bubble :global(p + p) {
    margin-top: 0.75rem;
  }

  .chat-message__bubble :global(ul),
  .chat-message__bubble :global(ol) {
    padding-left: 1.2rem;
    margin: 0.5rem 0 0;
  }

  .chat-runtime-card {
    align-self: flex-start;
    width: min(100%, 24rem);
    margin-bottom: 0.45rem;
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.2);
    overflow: hidden;
    box-shadow: 0 3px 12px rgba(15, 23, 42, 0.03);
  }

  .chat-runtime-card[open] {
    background: rgba(248, 250, 252, 0.96);
  }

  .chat-runtime-card--submitted,
  .chat-runtime-card--streaming {
    border-color: rgba(31, 111, 235, 0.18);
  }

  .chat-runtime-card--error {
    border-color: #fecdca;
    background: #fef3f2;
  }

  .chat-runtime-card__summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    padding: 0.58rem 0.72rem 0.56rem;
  }

  .chat-runtime-card__summary::-webkit-details-marker {
    display: none;
  }

  .chat-runtime-card__summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .chat-runtime-card__state {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: #111827;
    min-width: 0;
  }

  .chat-runtime-card__state strong {
    font-size: 0.84rem;
  }

  .chat-runtime-card__state--error {
    color: #b42318;
  }

  .chat-runtime-card__spinner {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 999px;
    border: 2px solid rgba(31, 111, 235, 0.2);
    border-top-color: #1f6feb;
    animation: chat-spin 0.9s linear infinite;
    flex: 0 0 auto;
  }

  .chat-runtime-card__badges {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chat-runtime-card__badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.05);
    color: #475467;
    font-size: 0.68rem;
    white-space: nowrap;
  }

  .chat-runtime-card__meta,
  .chat-runtime-card__summary-text {
    font-size: 0.74rem;
    color: #667085;
    line-height: 1.4;
  }

  .chat-runtime-card__body {
    display: grid;
    gap: 0.45rem;
    padding: 0 0.72rem 0.72rem;
    border-top: 1px solid rgba(15, 23, 42, 0.06);
  }

  .chat-runtime-card__reasoning {
    padding-top: 0.75rem;
  }

  .chat-runtime-card__reasoning h4 {
    margin: 0 0 0.35rem;
    font-size: 0.76rem;
    color: #111827;
  }

  .chat-runtime-card__reasoning p {
    margin: 0;
    color: #4b5563;
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .chat-runtime-card__steps {
    display: grid;
    gap: 0.45rem;
  }

  .chat-runtime-step {
    padding: 0.45rem 0.58rem;
    border-radius: 0.85rem;
    background: #fff;
    border: 1px solid rgba(148, 163, 184, 0.18);
  }

  .chat-runtime-step--completed {
    border-color: rgba(31, 111, 235, 0.18);
  }

  .chat-runtime-step--error {
    border-color: #fecdca;
    background: #fff6f5;
  }

  .chat-runtime-step__title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .chat-runtime-step__summary {
    list-style: none;
    cursor: pointer;
  }

  .chat-runtime-step__summary::-webkit-details-marker {
    display: none;
  }

  .chat-runtime-step__title-row strong {
    font-size: 0.74rem;
    flex: 1;
    min-width: 0;
  }

  .chat-runtime-step__kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.06);
    color: #475467;
    flex: 0 0 auto;
  }

  .chat-runtime-step__kind--tool {
    background: rgba(31, 111, 235, 0.08);
    color: #1f6feb;
  }

  .chat-runtime-step__kind--reasoning {
    background: rgba(8, 145, 178, 0.08);
    color: #0f766e;
  }

  .chat-runtime-step__status {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #667085;
  }

  .chat-runtime-step__status--completed {
    color: #1d4ed8;
  }

  .chat-runtime-step__status--error {
    color: #b42318;
  }

  .chat-runtime-step p {
    margin: 0.35rem 0 0;
    font-size: 0.72rem;
    color: #667085;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .chat-part {
    margin-top: 0.5rem;
    padding: 0.65rem 0.75rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  }

  .chat-part h4 {
    margin: 0 0 0.35rem;
    font-size: 0.82rem;
  }

  .chat-part--reasoning summary {
    cursor: pointer;
    font-weight: 600;
    list-style: none;
  }

  .chat-part--reasoning summary::-webkit-details-marker {
    display: none;
  }

  .chat-part--reasoning p {
    margin: 0.6rem 0 0;
    color: #475467;
  }

  .chat-part__label {
    margin: 0 0 0.65rem;
    font-weight: 600;
  }

  .chat-shell__error {
    margin: 0 0.75rem;
    padding: 0.75rem 0.9rem;
    border-radius: 0.75rem;
    background: #fef3f2;
    color: #b42318;
    border: 1px solid #fecdca;
  }

  .chat-sources {
    display: block;
  }

  .chat-sources__summary,
  .chat-sources__group-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .chat-sources__summary::-webkit-details-marker,
  .chat-sources__group-summary::-webkit-details-marker {
    display: none;
  }

  .chat-sources__summary strong,
  .chat-sources__group-summary span:first-child {
    font-size: 0.78rem;
  }

  .chat-sources__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.3rem;
    height: 1.3rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.06);
    color: #475467;
    font-size: 0.68rem;
  }

  .chat-sources__body {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.55rem;
  }

  .chat-sources__group {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 0.8rem;
    background: rgba(248, 250, 252, 0.85);
    padding: 0.45rem 0.55rem;
  }

  .chat-sources__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .chat-source-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
    max-width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: #fff;
    color: #1f2937;
    border-radius: 999px;
    padding: 0.34rem 0.58rem;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .chat-source-chip__doc {
    display: inline-block;
    max-width: 13rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
  }

  .chat-source-chip__meta {
    font-size: 0.65rem;
    color: #667085;
  }

  .chat-entity-cards {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.55rem;
  }

  .chat-entity-card {
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 0.85rem;
    background: #fff;
    padding: 0.6rem;
  }

  .chat-entity-card__main {
    width: 100%;
    border: none;
    background: transparent;
    padding: 0;
    color: #1f2937;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .chat-entity-card__header {
    display: flex;
    justify-content: space-between;
    gap: 0.55rem;
    align-items: flex-start;
  }

  .chat-entity-card__header strong {
    font-size: 0.76rem;
    line-height: 1.25;
  }

  .chat-entity-card__rank,
  .chat-entity-card__kind {
    color: #667085;
    font-size: 0.64rem;
  }

  .chat-entity-card__kind,
  .chat-entity-card__line {
    display: block;
    margin-top: 0.18rem;
  }

  .chat-entity-card__line {
    color: #475467;
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .chat-entity-card__docs {
    color: #1d4ed8;
  }

  .chat-entity-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.55rem;
  }

  .chat-entity-card__action {
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: #f8fafc;
    color: #1d4ed8;
    border-radius: 999px;
    padding: 0.28rem 0.55rem;
    font: inherit;
    font-size: 0.66rem;
    font-weight: 600;
    cursor: pointer;
  }

  .chat-update-link {
    display: block;
  }

  .chat-update-link__summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .chat-update-link__summary::-webkit-details-marker {
    display: none;
  }

  .chat-update-link__summary strong {
    font-size: 0.78rem;
  }

  .chat-update-link__task {
    font-size: 0.7rem;
    color: #667085;
  }

  .chat-update-link__body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.55rem;
  }

  .chat-update-link__label {
    margin: 0;
    font-size: 0.74rem;
    color: #475467;
  }

  .chat-update-link__button {
    border: 1px solid rgba(148, 163, 184, 0.24);
    background: #fff;
    color: #1d4ed8;
    border-radius: 999px;
    padding: 0.38rem 0.72rem;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }

  .chat-composer {
    padding: 0.7rem;
    background: rgba(255, 255, 255, 0.97);
    border-top: 1px solid rgba(15, 23, 42, 0.08);
  }

  .chat-composer__surface {
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 1rem;
    background: #fff;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
  }

  .chat-composer__surface--multiline {
    border-color: rgba(37, 99, 235, 0.28);
  }

  .chat-composer__input {
    display: block;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    min-height: 2.75rem;
    max-height: 11rem;
    resize: none;
    border: none;
    padding: 0.8rem 0.9rem 0.42rem;
    font: inherit;
    font-size: 0.94rem;
    line-height: 1.45;
    color: #101828;
    background: transparent;
  }

  .chat-composer__input:focus {
    outline: none;
  }

  .chat-composer__footer {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.6rem 0.55rem;
    border-top: 1px solid rgba(15, 23, 42, 0.06);
  }

  .chat-composer__selectors {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    flex-wrap: wrap;
  }

  .chat-composer__select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 999px;
    background: #f8fafc;
    padding: 0 0.35rem 0 0.55rem;
    height: 2rem;
  }

  .chat-composer__select-wrap--compact {
    padding-left: 0.5rem;
  }

  .chat-composer__select {
    min-width: 0;
    border: none;
    background: transparent;
    color: #101828;
    font: inherit;
    font-size: 0.78rem;
    padding: 0 1rem 0 0;
    cursor: pointer;
  }

  .chat-composer__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .chat-composer__actions {
    display: flex;
    align-items: center;
  }

  .chat-composer__primary {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .chat-composer__primary--stop {
    background: #eef2f7;
    color: #344054;
    box-shadow: none;
  }

  @keyframes chat-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 768px) {
    .chat-shell {
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }

    .chat-message__bubble {
      max-width: calc(100vw - 3rem);
    }

    .chat-runtime-card {
      width: calc(100vw - 3rem);
    }

    .chat-composer {
      padding: 0.6rem;
    }

    .chat-source-chip__doc {
      max-width: 10.5rem;
    }
  }
</style>
