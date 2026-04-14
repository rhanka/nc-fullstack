import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptRenderResult {
  readonly system: string;
  readonly user: string;
}

export class PromptTemplate {
  readonly legacyLlmId: string;
  readonly systemTemplate: string;
  readonly userTemplate: string;
  readonly inputNames: readonly string[];
  readonly temperature: number;
  readonly jsonMode: boolean;

  constructor(filePath: string) {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      llmId?: string;
      prompt: {
        textPromptSystemTemplate: string;
        textPromptTemplate: string;
        textPromptTemplateInputs?: Array<{ name: string }>;
      };
      completionSettings?: {
        temperature?: number;
        responseFormat?: { type?: string };
      };
    };

    this.legacyLlmId = raw.llmId ?? "";
    this.systemTemplate = raw.prompt.textPromptSystemTemplate;
    this.userTemplate = raw.prompt.textPromptTemplate;
    this.inputNames = (raw.prompt.textPromptTemplateInputs ?? []).map((item) => item.name);
    this.temperature = raw.completionSettings?.temperature ?? 0;
    this.jsonMode = raw.completionSettings?.responseFormat?.type === "json_object";
  }

  render(variables: Record<string, unknown>): PromptRenderResult {
    let system = this.systemTemplate;
    let user = this.userTemplate;
    for (const [key, value] of Object.entries(variables)) {
      const renderedValue =
        value == null
          ? ""
          : typeof value === "string"
            ? value
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : JSON.stringify(value);
      system = system.replaceAll(`{{${key}}}`, renderedValue);
      user = user.replaceAll(`{{${key}}}`, renderedValue);
    }
    return { system, user };
  }
}

const PROMPTS_ROOT = fileURLToPath(new URL("../../../api/src/prompts/", import.meta.url));

function loadPromptsFromDir(): Record<string, PromptTemplate> {
  const prompts: Record<string, PromptTemplate> = {};
  for (const filename of readdirSync(PROMPTS_ROOT)) {
    if (!filename.endsWith(".prompt")) {
      continue;
    }
    const key = filename.replace(/\.prompt$/u, "");
    prompts[key] = new PromptTemplate(path.join(PROMPTS_ROOT, filename));
  }
  return prompts;
}

export function buildPromptRegistry(): Record<string, PromptTemplate> {
  const prompts = loadPromptsFromDir();
  const aliasMap = {
    "000": "compute_nc_scenarios_propose_000",
    "100": "compute_nc_scenarios_propose_100",
    query: "compute_nc_scenarios_query",
    nc_search: "compute_nc_scenarios_search_nc",
    doc_search: "compute_nc_scenarios_search_techdocs",
  } as const;

  for (const [alias, target] of Object.entries(aliasMap)) {
    if (target in prompts) {
      prompts[alias] = prompts[target];
    }
  }

  return prompts;
}
