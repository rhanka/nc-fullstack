import type { LlmRuntime } from "../llm/index.ts";

export type ResponseComplexity = "simple" | "standard" | "deep";
export type ComplexitySelection = "auto" | ResponseComplexity;

export interface ComplexityAnalysisInput {
  readonly userRole?: string | null;
  readonly message: string;
  readonly description?: string | null;
  readonly historyExcerpt?: string | null;
}

export interface ComplexityAnalysisResult {
  readonly level: ResponseComplexity;
  readonly analyzerModel: "gpt-5.4-nano";
  readonly promptVersion: "complexity-eval-v1";
  readonly rawOutput: string;
}

export interface ComplexityAnalyzer {
  analyze(input: ComplexityAnalysisInput): Promise<ComplexityAnalysisResult>;
}

export function buildComplexityAnalysisPrompt(input: ComplexityAnalysisInput): string {
  return `Tu es un classificateur minimal de complexité pour un chat NC.

Objectif:
- classer le prochain tour assistant en EXACTEMENT UN SEUL TOKEN
- tokens autorisés: simple | standard | deep

Règles:
- simple: reformulation ou brouillon direct, ambiguïté faible, peu de vérifications.
- standard: synthèse métier normale, croisement de quelques sources, raisonnement modéré.
- deep: ambiguïté forte, enjeu élevé, arbitrage délicat, besoin probable de vérifications supplémentaires ou d'analyse prudente.

Contexte NC:
- rôle demandé: ${input.userRole ?? "(absent)"}
- message utilisateur: ${input.message.trim() || "(vide)"}
- description: ${input.description?.trim() || "(vide)"}
- historique récent: ${input.historyExcerpt?.trim() || "(vide)"}

Réponds avec EXACTEMENT UN SEUL TOKEN:
simple|standard|deep`;
}

export function parseComplexityLevel(output: string): ResponseComplexity {
  const token = output.trim().split(/\s+/g)[0]?.toLowerCase() ?? "";
  if (token === "simple" || token === "standard" || token === "deep") {
    return token;
  }
  throw new Error(`Invalid complexity token: "${output.trim().slice(0, 200)}"`);
}

export function createComplexityAnalyzer(runtime: LlmRuntime): ComplexityAnalyzer {
  return {
    async analyze(input: ComplexityAnalysisInput): Promise<ComplexityAnalysisResult> {
      const prompt = buildComplexityAnalysisPrompt(input);
      const response = await runtime.invoke({
        providerId: "openai",
        model: "gpt-5.4-nano",
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: 64,
      });

      return {
        level: parseComplexityLevel(response.text),
        analyzerModel: "gpt-5.4-nano",
        promptVersion: "complexity-eval-v1",
        rawOutput: response.text,
      };
    },
  };
}
