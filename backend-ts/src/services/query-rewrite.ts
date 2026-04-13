import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_RE = /[a-z0-9]{2,}/g;

export interface QueryRewriteResult {
  readonly originalQuery: string;
  readonly normalizedQuery: string;
  readonly corpus: string;
  readonly variants: readonly string[];
  readonly reasons: readonly string[];
  readonly llmUsed: boolean;
  readonly llmModel: string | null;
  readonly llmError: string | null;
}

function compactWhitespace(value: string): string {
  return String(value).trim().split(/\s+/u).join(" ");
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
}

export function tokenizeQuery(value: string): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  const matches = normalizeText(value).match(TOKEN_RE) ?? [];
  for (const token of matches) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

function variantIdentity(value: string): string {
  return tokenizeQuery(value).join(" ");
}

function addUniqueVariant(variants: string[], seen: Set<string>, candidate: string): void {
  const normalizedCandidate = compactWhitespace(candidate);
  if (!normalizedCandidate) {
    return;
  }
  const identity = variantIdentity(normalizedCandidate);
  if (!identity || seen.has(identity)) {
    return;
  }
  seen.add(identity);
  variants.push(normalizedCandidate);
}

function containsAny(tokens: readonly string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.includes(candidate));
}

function buildRuleBasedVariants(query: string, corpus: string): {
  readonly variants: string[];
  readonly reasons: string[];
} {
  const normalizedQuery = compactWhitespace(query);
  const normalizedTokens = tokenizeQuery(normalizedQuery);
  const tokenSet = new Set(normalizedTokens);
  const variants: string[] = [normalizedQuery];
  const reasons: string[] = [];
  const seen = new Set([variantIdentity(normalizedQuery)]);

  const fuelTokens = [
    "fuel",
    "tank",
    "reservoir",
    "collector",
    "surge",
    "refuel",
    "defuel",
    "pump",
    "quantity",
    "gauge",
    "probe",
  ];
  const electricalTokens = ["electrostatic", "static", "esd", "grounding", "bonding", "electrical"];
  const structuralTokens = [
    "windshield",
    "frame",
    "flushness",
    "rivets",
    "rivet",
    "pare",
    "brise",
    "structural",
    "repair",
  ];
  const damageTokens = ["scratch", "damage", "rayure", "zone", "surface", "aluminum", "aluminium"];
  const doorTokens = ["door", "delamination", "composite"];

  const hasFuelSignal = containsAny(normalizedTokens, fuelTokens);
  const hasElectricalSignal = containsAny(normalizedTokens, electricalTokens);
  const hasStructuralSignal = containsAny(normalizedTokens, structuralTokens);
  const hasDamageSignal = containsAny(normalizedTokens, damageTokens);
  const hasDoorSignal = containsAny(normalizedTokens, doorTokens);

  const wingSideTerms: string[] = [];
  if (tokenSet.has("left") || tokenSet.has("gauche")) {
    wingSideTerms.push("left wing", "left main tank");
    reasons.push("left wing context detected");
  }
  if (tokenSet.has("right") || tokenSet.has("droite") || tokenSet.has("droit")) {
    wingSideTerms.push("right wing", "right main tank");
    reasons.push("right wing context detected");
  }

  if (hasFuelSignal) {
    reasons.push("fuel / tank context inferred");
    addUniqueVariant(
      variants,
      seen,
      corpus === "non_conformities"
        ? "ATA 28 fuel system fuel tank fuel quantity fuel pump sensor wiring"
        : "ATA 28 fuel system fuel tank collector tank surge tank",
    );
  }

  if (hasElectricalSignal) {
    reasons.push("electrical / grounding context inferred");
    addUniqueVariant(
      variants,
      seen,
      "electrical grounding bonding electrostatic discharge static discharge ESD",
    );
  }

  if (hasFuelSignal && hasElectricalSignal) {
    reasons.push("fuel plus electrical combination inferred");
    let joined = "ATA 28 fuel tank electrical grounding bonding electrostatic discharge";
    if (wingSideTerms.length > 0) {
      joined = `${joined} ${wingSideTerms.join(" ")}`;
    }
    joined =
      corpus === "non_conformities"
        ? `${joined} wiring fuel pump sensor`
        : `${joined} collector tank surge tank`;
    addUniqueVariant(variants, seen, joined);
  }

  if (hasStructuralSignal) {
    reasons.push("windshield / structural repair context inferred");
    addUniqueVariant(variants, seen, "ATA 56 windshield frame rivet structural repair flushness");
  }

  if (hasDamageSignal) {
    reasons.push("surface damage context inferred");
    addUniqueVariant(variants, seen, "surface damage structural repair airframe scratch zone");
  }

  if (hasDoorSignal) {
    reasons.push("door composite context inferred");
    addUniqueVariant(variants, seen, "ATA 52 door composite delamination frame structure");
  }

  if (wingSideTerms.length > 0 && !(hasFuelSignal && hasElectricalSignal)) {
    addUniqueVariant(variants, seen, wingSideTerms.join(" "));
  }

  return { variants, reasons };
}

export function rewriteRetrievalQuery(query: string, corpus: string): QueryRewriteResult {
  const { variants, reasons } = buildRuleBasedVariants(query, corpus);
  return {
    originalQuery: compactWhitespace(query),
    normalizedQuery: normalizeText(query),
    corpus,
    variants: variants.slice(0, 4),
    reasons: [...new Set(reasons)],
    llmUsed: false,
    llmModel: null,
    llmError: null,
  };
}

export function collectQueryVariants(
  query: string,
  options: {
    readonly corpus: string;
    readonly useQueryRewrite: boolean;
  },
): string[] {
  const normalizedQuery = String(query).trim();
  if (!options.useQueryRewrite) {
    return [normalizedQuery];
  }
  const rewrite = rewriteRetrievalQuery(normalizedQuery, options.corpus);
  return rewrite.variants.length > 0 ? [...rewrite.variants] : [normalizedQuery];
}

export const PROMPT_ROOT = fileURLToPath(new URL("../../../api/src/prompts/", import.meta.url));
export function resolvePromptPath(filename: string): string {
  return path.join(PROMPT_ROOT, filename);
}
