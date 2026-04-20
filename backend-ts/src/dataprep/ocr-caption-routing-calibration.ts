import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listOcrCaptionBenchmarkCandidates,
  selectOcrCaptionBenchmarkSamples,
  type OcrCaptionBenchmarkSample,
} from "./ocr-caption-benchmark.ts";
import {
  normalizeImageCaptionAnalysis,
  type ImageCaptionAnalysis,
  type ImageCaptionClientInput,
  type ImageCaptionReasoning,
} from "./ocr-tech-docs.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

export const IMAGE_CAPTION_V2_SCHEMA_VERSION = "a220_image_caption_v2";

const VISUAL_CONTENT_TYPES = [
  "cover_page",
  "front_matter",
  "index_page",
  "blank_page",
  "separation_page",
  "simple_labeled_component_view",
  "cockpit_panel_or_display",
  "technical_table",
  "technical_photo",
  "technical_procedure",
  "system_architecture_diagram",
  "flow_diagram",
  "wiring_signal_bus_diagram",
  "fuel_oil_hydraulic_transfer_diagram",
  "component_hierarchy_or_exploded_view",
  "other",
  "unclear",
] as const;

const DOMAIN_CANDIDATES = [
  "fuel",
  "power_plant_oil",
  "flight_controls",
  "hydraulics",
  "avionics_electrical",
  "airframe",
  "doors",
  "landing_gear",
  "cabin",
  "oxygen",
  "fire_protection",
  "unknown",
] as const;

const ENTITY_TYPES = [
  "ata",
  "part",
  "zone",
  "system",
  "system_component",
  "sensor",
  "actuator",
  "valve",
  "panel",
  "display",
  "procedure",
  "figure",
  "other",
] as const;

const RELATION_TYPES = [
  "contains",
  "part_of",
  "located_in",
  "connected_to",
  "interfaces_with",
  "feeds",
  "sends_signal_to",
  "receives_signal_from",
  "controls",
  "monitors",
  "actuates",
  "transfers_to",
  "routes_to",
  "indicates",
  "protects",
  "other",
] as const;

const NON_CONTENT_VISUAL_TYPES: ReadonlySet<VisualContentType> = new Set([
  "cover_page",
  "front_matter",
  "index_page",
  "blank_page",
  "separation_page",
]);

const DEEP_VALUE_VISUAL_TYPES: ReadonlySet<VisualContentType> = new Set([
  "system_architecture_diagram",
  "flow_diagram",
  "wiring_signal_bus_diagram",
  "fuel_oil_hydraulic_transfer_diagram",
  "component_hierarchy_or_exploded_view",
]);

export type VisualContentType = (typeof VISUAL_CONTENT_TYPES)[number];
export type DomainCandidate = (typeof DOMAIN_CANDIDATES)[number];
export type EntityCandidateType = (typeof ENTITY_TYPES)[number];
export type RelationshipCandidateRelation = (typeof RELATION_TYPES)[number];
export type ImageCaptionRoute = "nano" | "gpt-5.4";
export type CalibrationHumanLabel =
  | "nano_sufficient"
  | "deep_useful_for_rag"
  | "deep_useful_for_wiki"
  | "deep_required"
  | "ambiguous";
export type RoutingComparisonOutcome = "match" | "false_nano" | "false_gpt54" | "ambiguous" | "unlabeled";
export type RoutingCalibrationDecision = "accept_matrix" | "revise_matrix" | "reject_cascade" | "pending_labels";

export interface RoutingProfileEntityCandidate {
  readonly label: string;
  readonly type: EntityCandidateType;
  readonly evidence: string;
}

export interface RoutingProfileRelationshipCandidate {
  readonly source: string;
  readonly relation: RelationshipCandidateRelation;
  readonly target: string;
  readonly evidence: string;
}

export interface RoutingProfileV1 {
  readonly visual_content_type: VisualContentType;
  readonly domain_candidates: readonly DomainCandidate[];
  readonly rag_signal: {
    readonly ocr_markdown_sufficient: boolean;
    readonly visual_caption_adds_retrieval_terms: boolean;
    readonly retrieval_terms: readonly string[];
  };
  readonly wiki_signal: {
    readonly has_named_entities: boolean;
    readonly has_entity_relationships: boolean;
    readonly has_part_zone_or_ata_candidates: boolean;
    readonly has_component_hierarchy: boolean;
    readonly entity_candidates: readonly RoutingProfileEntityCandidate[];
    readonly relationship_candidates: readonly RoutingProfileRelationshipCandidate[];
  };
  readonly routing_evidence: readonly string[];
}

export interface ImageCaptionV2 extends Omit<ImageCaptionAnalysis, "schema_version"> {
  readonly schema_version: typeof IMAGE_CAPTION_V2_SCHEMA_VERSION;
  readonly routing_profile_v1: RoutingProfileV1;
}

export interface ImageCaptionV2Client {
  readonly provider: string;
  readonly model: string;
  analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionV2>;
}

export interface ImageCaptionRoutingDecision {
  readonly route: ImageCaptionRoute;
  readonly reasons: readonly string[];
}

export interface RoutingComparison {
  readonly route: ImageCaptionRoute;
  readonly label: CalibrationHumanLabel | null;
  readonly outcome: RoutingComparisonOutcome;
}

export interface OcrCaptionRoutingCalibrationResult {
  readonly sample: OcrCaptionBenchmarkSample;
  readonly status: "ok" | "error";
  readonly durationMs: number;
  readonly outputPath: string;
  readonly provider: string;
  readonly model: string;
  readonly caption?: ImageCaptionV2;
  readonly routing?: ImageCaptionRoutingDecision;
  readonly humanLabel?: CalibrationHumanLabel;
  readonly comparison?: RoutingComparison;
  readonly error?: string;
}

export interface OcrCaptionRoutingCalibrationMetrics {
  readonly totalPages: number;
  readonly routedNano: number;
  readonly routedGpt54: number;
  readonly falseNano: number;
  readonly falseGpt54: number;
  readonly ambiguous: number;
  readonly unlabeled: number;
  readonly gpt54CallRatio: number;
}

export interface OcrCaptionRoutingCalibrationSummary {
  readonly model: string;
  readonly sampleLimit: number;
  readonly sampleCount: number;
  readonly outputDir: string;
  readonly labelsPath: string | null;
  readonly samplesPath: string;
  readonly resultsPath: string;
  readonly reportPath: string;
  readonly metrics: OcrCaptionRoutingCalibrationMetrics;
  readonly decision: RoutingCalibrationDecision;
  readonly results: readonly OcrCaptionRoutingCalibrationResult[];
}

export interface OcrCaptionRoutingCalibrationOptions {
  readonly ocrDir: string;
  readonly outputDir: string;
  readonly limit: number;
  readonly samplePath?: string;
  readonly labelsPath?: string;
  readonly reportPath?: string;
  readonly imageDetail?: string;
  readonly client?: ImageCaptionV2Client;
  readonly onProgress?: (event: OcrCaptionRoutingCalibrationProgressEvent) => void;
}

export interface OcrCaptionRoutingCalibrationProgressEvent {
  readonly phase: "start" | "ok" | "error";
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly doc: string;
  readonly model: string;
  readonly durationMs?: number;
  readonly outputPath?: string;
  readonly error?: string;
}

export interface OcrCaptionRoutingCalibrationPaths {
  readonly ocrDir: string;
  readonly outputDir: string;
  readonly reportPath: string;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteFile(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tmpPath = filePath + ".tmp-" + String(process.pid);
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function stableSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
}

function stringifyCaptionValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(stringifyCaptionValue).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => {
        const nestedText = stringifyCaptionValue(nested);
        return nestedText ? key + ": " + nestedText : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value).trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(stringifyCaptionValue).filter(Boolean);
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : String(value ?? "").trim().toLowerCase() === "true";
}

function isVisualContentType(value: string): value is VisualContentType {
  return (VISUAL_CONTENT_TYPES as readonly string[]).includes(value);
}

function isDomainCandidate(value: string): value is DomainCandidate {
  return (DOMAIN_CANDIDATES as readonly string[]).includes(value);
}

function isEntityCandidateType(value: string): value is EntityCandidateType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

function isRelationshipCandidateRelation(value: string): value is RelationshipCandidateRelation {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

function normalizeDomains(value: unknown): DomainCandidate[] {
  const domains = stringArray(value).map((candidate): DomainCandidate =>
    isDomainCandidate(candidate) ? candidate : "unknown",
  );
  return uniqueStrings(domains.length > 0 ? domains : ["unknown"]);
}

function normalizeEntityCandidates(value: unknown): RoutingProfileEntityCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const input = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const label = stringifyCaptionValue(input.label);
      if (!label) {
        return null;
      }
      const rawType = stringifyCaptionValue(input.type);
      return {
        label,
        type: isEntityCandidateType(rawType) ? rawType : "other",
        evidence: stringifyCaptionValue(input.evidence),
      };
    })
    .filter((entry): entry is RoutingProfileEntityCandidate => entry !== null);
}

function normalizeRelationshipCandidates(value: unknown): RoutingProfileRelationshipCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const input = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const source = stringifyCaptionValue(input.source);
      const target = stringifyCaptionValue(input.target);
      if (!source || !target) {
        return null;
      }
      const rawRelation = stringifyCaptionValue(input.relation);
      return {
        source,
        relation: isRelationshipCandidateRelation(rawRelation) ? rawRelation : "other",
        target,
        evidence: stringifyCaptionValue(input.evidence),
      };
    })
    .filter((entry): entry is RoutingProfileRelationshipCandidate => entry !== null);
}

function inferVisualContentTypeFromV1(analysis: ImageCaptionAnalysis): VisualContentType {
  if (analysis.page_category === "cover_page") {
    return "cover_page";
  }
  if (analysis.page_category === "front_matter") {
    return "front_matter";
  }
  if (analysis.page_category === "index_page") {
    return "index_page";
  }
  if (analysis.page_category === "blank_page") {
    return "blank_page";
  }
  if (analysis.page_category === "separation_page") {
    return "separation_page";
  }
  if (analysis.page_category === "technical_table") {
    return "technical_table";
  }
  if (analysis.page_category === "technical_photo") {
    return "technical_photo";
  }
  if (analysis.page_category === "technical_procedure") {
    return "technical_procedure";
  }
  return analysis.page_category === "technical_diagram" ? "unclear" : "other";
}

function inferPageCategoryFromVisualContentType(
  visualContentType: VisualContentType,
): ImageCaptionAnalysis["page_category"] {
  if (visualContentType === "cover_page") {
    return "cover_page";
  }
  if (visualContentType === "front_matter") {
    return "front_matter";
  }
  if (visualContentType === "index_page") {
    return "index_page";
  }
  if (visualContentType === "blank_page") {
    return "blank_page";
  }
  if (visualContentType === "separation_page") {
    return "separation_page";
  }
  if (visualContentType === "technical_table") {
    return "technical_table";
  }
  if (visualContentType === "technical_photo") {
    return "technical_photo";
  }
  if (visualContentType === "technical_procedure") {
    return "technical_procedure";
  }
  return "technical_diagram";
}

function fallbackSummaryFromRoutingProfile(profile: RoutingProfileV1): string {
  const readableType = profile.visual_content_type.replace(/_/gu, " ");
  const terms = profile.rag_signal.retrieval_terms.slice(0, 6).join(", ");
  if (terms) {
    return readableType + ": " + terms + ".";
  }
  const firstEntity = profile.wiki_signal.entity_candidates[0]?.label;
  return firstEntity ? readableType + ": " + firstEntity + "." : readableType + ".";
}

function fallbackDescriptionFromRoutingProfile(profile: RoutingProfileV1, summary: string): string {
  const lines = [summary];
  const entities = profile.wiki_signal.entity_candidates
    .slice(0, 12)
    .map((entity) => entity.label + " (" + entity.type + (entity.evidence ? ", " + entity.evidence : "") + ")");
  if (entities.length > 0) {
    lines.push("Entities: " + entities.join("; ") + ".");
  }
  const relationships = profile.wiki_signal.relationship_candidates
    .slice(0, 12)
    .map((relation) => relation.source + " " + relation.relation + " " + relation.target);
  if (relationships.length > 0) {
    lines.push("Relationships: " + relationships.join("; ") + ".");
  }
  if (profile.routing_evidence.length > 0) {
    lines.push("Evidence: " + profile.routing_evidence.slice(0, 8).join("; ") + ".");
  }
  return lines.join(" ");
}

export function normalizeRoutingProfileV1(value: unknown, baseAnalysis?: ImageCaptionAnalysis): RoutingProfileV1 {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawType = stringifyCaptionValue(input.visual_content_type);
  const visualContentType = isVisualContentType(rawType)
    ? rawType
    : baseAnalysis
      ? inferVisualContentTypeFromV1(baseAnalysis)
      : "unclear";
  const ragSignal = (input.rag_signal && typeof input.rag_signal === "object" ? input.rag_signal : {}) as Record<
    string,
    unknown
  >;
  const wikiSignal = (input.wiki_signal && typeof input.wiki_signal === "object" ? input.wiki_signal : {}) as Record<
    string,
    unknown
  >;

  return {
    visual_content_type: visualContentType,
    domain_candidates: normalizeDomains(input.domain_candidates),
    rag_signal: {
      ocr_markdown_sufficient: booleanValue(ragSignal.ocr_markdown_sufficient),
      visual_caption_adds_retrieval_terms: booleanValue(ragSignal.visual_caption_adds_retrieval_terms),
      retrieval_terms: stringArray(ragSignal.retrieval_terms),
    },
    wiki_signal: {
      has_named_entities: booleanValue(wikiSignal.has_named_entities),
      has_entity_relationships: booleanValue(wikiSignal.has_entity_relationships),
      has_part_zone_or_ata_candidates: booleanValue(wikiSignal.has_part_zone_or_ata_candidates),
      has_component_hierarchy: booleanValue(wikiSignal.has_component_hierarchy),
      entity_candidates: normalizeEntityCandidates(wikiSignal.entity_candidates),
      relationship_candidates: normalizeRelationshipCandidates(wikiSignal.relationship_candidates),
    },
    routing_evidence: stringArray(input.routing_evidence),
  };
}

export function normalizeImageCaptionV2(value: unknown): ImageCaptionV2 {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const base = normalizeImageCaptionAnalysis(input);
  const profile = normalizeRoutingProfileV1(input.routing_profile_v1, base);
  const hasExplicitPageCategory = typeof input.page_category === "string" && input.page_category.trim() !== "";
  const pageCategory = hasExplicitPageCategory
    ? base.page_category
    : inferPageCategoryFromVisualContentType(profile.visual_content_type);
  const pageCategoryConfidence =
    typeof input.page_category_confidence === "number" || typeof input.page_category_confidence === "string"
      ? base.page_category_confidence
      : 0.75;
  const fallbackSummary = fallbackSummaryFromRoutingProfile(profile);
  const shortSummary = base.short_summary || fallbackSummary;
  return {
    ...base,
    schema_version: IMAGE_CAPTION_V2_SCHEMA_VERSION,
    page_category: pageCategory,
    page_category_confidence: pageCategoryConfidence,
    is_non_content_page:
      pageCategory === "cover_page" ||
      pageCategory === "front_matter" ||
      pageCategory === "index_page" ||
      pageCategory === "blank_page" ||
      pageCategory === "separation_page"
        ? true
        : base.is_non_content_page,
    short_summary: shortSummary,
    technical_description: base.technical_description || fallbackDescriptionFromRoutingProfile(profile, shortSummary),
    routing_profile_v1: profile,
  };
}

export function routeImageCaptionV2(caption: ImageCaptionV2): ImageCaptionRoutingDecision {
  const profile = caption.routing_profile_v1;
  const reasons: string[] = [];

  if (NON_CONTENT_VISUAL_TYPES.has(profile.visual_content_type)) {
    reasons.push("non-content visual type");
    return { route: "nano", reasons };
  }

  if (DEEP_VALUE_VISUAL_TYPES.has(profile.visual_content_type)) {
    reasons.push("relationship-heavy visual type: " + profile.visual_content_type);
    return { route: "gpt-5.4", reasons };
  }

  const entityCount = profile.wiki_signal.entity_candidates.length;
  const relationshipCount = profile.wiki_signal.relationship_candidates.length;
  const retrievalTermCount = profile.rag_signal.retrieval_terms.length;
  const domains = new Set(profile.domain_candidates);
  const retrievalTerms = profile.rag_signal.retrieval_terms.join(" ");

  if (profile.visual_content_type === "technical_table" || profile.visual_content_type === "technical_photo") {
    reasons.push("OCR/table/photo content stays on nano unless classified as a high-value diagram");
    return { route: "nano", reasons };
  }

  if (
    profile.visual_content_type === "simple_labeled_component_view" &&
    profile.wiki_signal.has_component_hierarchy &&
    entityCount >= 9 &&
    relationshipCount >= 5
  ) {
    reasons.push("dense component hierarchy in labeled component view");
    return { route: "gpt-5.4", reasons };
  }

  if (
    profile.visual_content_type === "cockpit_panel_or_display" &&
    profile.wiki_signal.has_entity_relationships &&
    entityCount >= 8 &&
    relationshipCount >= 5 &&
    (domains.has("flight_controls") ||
      domains.has("power_plant_oil") ||
      /\b(autoland|autothrottle|thrust\s+reverser|eicas\s+flag|reverse|rev)\b/iu.test(retrievalTerms))
  ) {
    reasons.push("cockpit panel with high-value operational mode/state relationships");
    return { route: "gpt-5.4", reasons };
  }

  if (
    profile.visual_content_type === "other" &&
    profile.wiki_signal.has_entity_relationships &&
    entityCount >= 6 &&
    relationshipCount >= 4
  ) {
    reasons.push("unclear visual type but dense relationships and entities");
    return { route: "gpt-5.4", reasons };
  }

  if (
    profile.visual_content_type === "technical_procedure" &&
    !profile.rag_signal.ocr_markdown_sufficient &&
    retrievalTermCount >= 8 &&
    relationshipCount >= 4 &&
    domains.has("power_plant_oil")
  ) {
    reasons.push("visual procedure carries high-value power-plant relation value");
    return { route: "gpt-5.4", reasons };
  }

  reasons.push("nano sufficient by candidate matrix");
  return { route: "nano", reasons };
}

export function compareRoutingDecisionWithLabel(
  route: ImageCaptionRoute,
  label: CalibrationHumanLabel | null | undefined,
): RoutingComparison {
  if (!label) {
    return { route, label: null, outcome: "unlabeled" };
  }
  if (label === "ambiguous") {
    return { route, label, outcome: "ambiguous" };
  }
  const deepUseful = label === "deep_useful_for_rag" || label === "deep_useful_for_wiki" || label === "deep_required";
  if (route === "nano" && deepUseful) {
    return { route, label, outcome: "false_nano" };
  }
  if (route === "gpt-5.4" && label === "nano_sufficient") {
    return { route, label, outcome: "false_gpt54" };
  }
  return { route, label, outcome: "match" };
}

function isCalibrationHumanLabel(value: string): value is CalibrationHumanLabel {
  return (
    value === "nano_sufficient" ||
    value === "deep_useful_for_rag" ||
    value === "deep_useful_for_wiki" ||
    value === "deep_required" ||
    value === "ambiguous"
  );
}

function readCalibrationLabels(labelsPath: string | undefined): Map<string, CalibrationHumanLabel> {
  if (!labelsPath || !existsSync(labelsPath)) {
    return new Map();
  }
  const parsed = readJsonFile<unknown>(labelsPath);
  const labels = new Map<string, CalibrationHumanLabel>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const input = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const doc = stringifyCaptionValue(input.doc);
      const label = stringifyCaptionValue(input.label);
      if (doc && isCalibrationHumanLabel(label)) {
        labels.set(doc, label);
      }
    }
    return labels;
  }
  if (parsed && typeof parsed === "object") {
    for (const [doc, labelValue] of Object.entries(parsed)) {
      const label = stringifyCaptionValue(labelValue);
      if (isCalibrationHumanLabel(label)) {
        labels.set(doc, label);
      }
    }
  }
  return labels;
}

function readSamplesFromFile(samplePath: string | undefined): OcrCaptionBenchmarkSample[] | null {
  if (!samplePath || !existsSync(samplePath)) {
    return null;
  }
  const parsed = readJsonFile<unknown>(samplePath);
  if (!Array.isArray(parsed)) {
    return null;
  }
  return parsed.map((entry) => entry as OcrCaptionBenchmarkSample);
}

export function getDefaultOcrCaptionRoutingCalibrationPaths(): OcrCaptionRoutingCalibrationPaths {
  const root = path.join(API_ROOT, "data", TECH_DOCS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return {
    ocrDir: path.join(root, "ocr"),
    outputDir: path.join(root, "benchmarks", "ocr-routing-calibration-" + stamp),
    reportPath: path.join(REPO_ROOT, "spec", "REPORT_L6_10B_OCR_ROUTING_CALIBRATION.md"),
  };
}

function selectCalibrationSamples(options: OcrCaptionRoutingCalibrationOptions): OcrCaptionBenchmarkSample[] {
  const cachedSamples = readSamplesFromFile(options.samplePath);
  if (cachedSamples) {
    return cachedSamples.slice(0, Math.max(0, Math.floor(options.limit)));
  }
  return selectOcrCaptionBenchmarkSamples(listOcrCaptionBenchmarkCandidates(options.ocrDir), options.limit);
}

function computeMetrics(results: readonly OcrCaptionRoutingCalibrationResult[]): OcrCaptionRoutingCalibrationMetrics {
  const okResults = results.filter((entry) => entry.status === "ok");
  const routedNano = okResults.filter((entry) => entry.routing?.route === "nano").length;
  const routedGpt54 = okResults.filter((entry) => entry.routing?.route === "gpt-5.4").length;
  const falseNano = okResults.filter((entry) => entry.comparison?.outcome === "false_nano").length;
  const falseGpt54 = okResults.filter((entry) => entry.comparison?.outcome === "false_gpt54").length;
  const ambiguous = okResults.filter((entry) => entry.comparison?.outcome === "ambiguous").length;
  const unlabeled = okResults.filter((entry) => entry.comparison?.outcome === "unlabeled").length;
  return {
    totalPages: okResults.length,
    routedNano,
    routedGpt54,
    falseNano,
    falseGpt54,
    ambiguous,
    unlabeled,
    gpt54CallRatio: okResults.length === 0 ? 0 : routedGpt54 / okResults.length,
  };
}

function decideCalibration(metrics: OcrCaptionRoutingCalibrationMetrics): RoutingCalibrationDecision {
  if (metrics.totalPages === 0 || metrics.unlabeled > 0) {
    return "pending_labels";
  }
  if (metrics.falseNano > 0) {
    return "revise_matrix";
  }
  if (metrics.falseGpt54 / Math.max(1, metrics.routedGpt54) > 0.25) {
    return "revise_matrix";
  }
  if (metrics.gpt54CallRatio > 0.45) {
    return "revise_matrix";
  }
  return "accept_matrix";
}

function renderExamples(
  results: readonly OcrCaptionRoutingCalibrationResult[],
  outcome: RoutingComparisonOutcome,
): string[] {
  return results
    .filter((entry) => entry.comparison?.outcome === outcome)
    .slice(0, 5)
    .map((entry) => {
      const route = entry.routing?.route ?? "n/a";
      const label = entry.humanLabel ?? "n/a";
      return "- `" + entry.sample.doc + "`: route `" + route + "`, label `" + label + "`";
    });
}

function renderMarkdownReport(summary: OcrCaptionRoutingCalibrationSummary): string {
  const metrics = summary.metrics;
  const lines = [
    "# L6.10b OCR Routing Calibration",
    "",
    "## Scope",
    "",
    "Replay calibration for `a220_image_caption_v2` / `routing_profile_v1`. This report validates or rejects the candidate route matrix before any OCR caption cascade is implemented.",
    "",
    "## Run",
    "",
    "- Model replayed: `" + summary.model + "`",
    "- Samples replayed: " + String(summary.sampleCount),
    "- Labels: " + (summary.labelsPath ? "`" + summary.labelsPath + "`" : "`none`"),
    "- Output directory: `" + summary.outputDir + "`",
    "- Decision: `" + summary.decision + "`",
    "",
    "## Metrics",
    "",
    "- Total pages replayed: " + String(metrics.totalPages),
    "- Routed nano: " + String(metrics.routedNano),
    "- Routed gpt-5.4: " + String(metrics.routedGpt54),
    "- False nano: " + String(metrics.falseNano),
    "- False gpt-5.4: " + String(metrics.falseGpt54),
    "- Ambiguous pages: " + String(metrics.ambiguous),
    "- Unlabeled pages: " + String(metrics.unlabeled),
    "- Estimated gpt-5.4 call ratio: " + (metrics.gpt54CallRatio * 100).toFixed(1) + "%",
    "",
    "## Samples",
    "",
    "| Doc | Type | Route | Label | Outcome | Reasons |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of summary.results) {
    const type = result.caption?.routing_profile_v1.visual_content_type ?? "error";
    const route = result.routing?.route ?? "error";
    const label = result.humanLabel ?? "";
    const outcome = result.comparison?.outcome ?? (result.status === "error" ? "error" : "");
    const reasons = result.routing?.reasons.join("<br>") ?? result.error ?? "";
    lines.push(
      "| `" +
        result.sample.doc.replace(/\|/gu, "\\|") +
        "` | `" +
        type +
        "` | `" +
        route +
        "` | `" +
        label +
        "` | `" +
        outcome +
        "` | " +
        reasons.replace(/\|/gu, "\\|") +
        " |",
    );
  }

  lines.push("", "## Confusion Examples", "");
  for (const [title, outcome] of [
    ["False nano", "false_nano"],
    ["False gpt-5.4", "false_gpt54"],
    ["Ambiguous", "ambiguous"],
    ["Unlabeled", "unlabeled"],
  ] as const) {
    lines.push("### " + title, "");
    const examples = renderExamples(summary.results, outcome);
    lines.push(...(examples.length > 0 ? examples : ["- None"]));
    lines.push("");
  }

  if (summary.decision === "pending_labels") {
    lines.push(
      "## Gate",
      "",
      "The cascade gate remains closed because at least one replayed page is unlabeled. Add labels from the paired L6.10a benchmark review, then rerun calibration.",
    );
  } else if (summary.decision === "revise_matrix") {
    lines.push(
      "## Gate",
      "",
      "The candidate matrix is not accepted. Revise routing criteria or labels before implementing `L6.10d`.",
    );
  } else {
    lines.push("## Gate", "", "The candidate matrix is accepted for `L6.10d` implementation.");
  }

  return lines.join("\n") + "\n";
}

export function extractResponseText(payload: unknown): string {
  const response = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        return [];
      }
      return content
        .map((contentItem) => {
          if (!contentItem || typeof contentItem !== "object") {
            return "";
          }
          const maybeText = (contentItem as Record<string, unknown>).text;
          return typeof maybeText === "string" ? maybeText : "";
        })
        .filter(Boolean);
    })
    .join("");
}

export const A220_IMAGE_CAPTION_V2_PROMPT = [
  "You are calibrating OCR image caption routing for A220 technical documentation.",
  "Return JSON only using schema version a220_image_caption_v2.",
  "Keep all v1 caption fields compatible with a220_image_caption_v1, then add routing_profile_v1.",
  "You receive OCR-extracted image crops plus OCR Markdown context. You do not receive a full PDF page render.",
  "Describe only visible or OCR-supported content. Do not invent identifiers, relations, ATA, part numbers or zones.",
  "For routing_profile_v1, classify visual_content_type with the controlled vocabulary from the spec.",
  "Do not output a final model route. TypeScript owns routing. Output evidence, retrieval terms, entities and relationships only.",
  "Required routing_profile_v1 keys: visual_content_type, domain_candidates, rag_signal, wiki_signal, routing_evidence.",
  "rag_signal keys: ocr_markdown_sufficient, visual_caption_adds_retrieval_terms, retrieval_terms.",
  "wiki_signal keys: has_named_entities, has_entity_relationships, has_part_zone_or_ata_candidates, has_component_hierarchy, entity_candidates, relationship_candidates.",
  "Entity candidate fields: label, type, evidence. Relationship candidate fields: source, relation, target, evidence.",
  "Allowed visual_content_type values: " + VISUAL_CONTENT_TYPES.join(", ") + ".",
  "Allowed domain_candidates values: " + DOMAIN_CANDIDATES.join(", ") + ".",
  "Allowed entity type values: " + ENTITY_TYPES.join(", ") + ".",
  "Allowed relationship relation values: " + RELATION_TYPES.join(", ") + ".",
].join("\n");

export class OpenAIImageCaptionV2Client implements ImageCaptionV2Client {
  readonly provider = "openai";
  readonly model: string;
  readonly apiKey: string;
  readonly endpoint: string;
  readonly imageDetail: string;
  readonly reasoning: ImageCaptionReasoning;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;

  constructor(options: {
    readonly apiKey?: string;
    readonly model?: string;
    readonly endpoint?: string;
    readonly imageDetail?: string;
    readonly reasoning?: ImageCaptionReasoning;
    readonly maxOutputTokens?: number;
    readonly timeoutMs?: number;
  } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OCR_ROUTING_CALIBRATION_MODEL ?? "gpt-5.4-nano";
    this.endpoint = options.endpoint ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.imageDetail = options.imageDetail ?? process.env.OCR_ROUTING_CALIBRATION_IMAGE_DETAIL ?? "original";
    this.reasoning =
      options.reasoning ?? (process.env.OCR_ROUTING_CALIBRATION_REASONING as ImageCaptionReasoning | undefined) ?? "low";
    this.maxOutputTokens =
      options.maxOutputTokens ?? Number.parseInt(process.env.OCR_ROUTING_CALIBRATION_MAX_OUTPUT_TOKENS ?? "6000", 10);
    this.timeoutMs =
      options.timeoutMs ?? Number.parseInt(process.env.OCR_ROUTING_CALIBRATION_TIMEOUT_MS ?? "120000", 10);
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OCR routing calibration");
    }
  }

  async analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionV2> {
    const content = [
      {
        type: "input_text",
        text:
          A220_IMAGE_CAPTION_V2_PROMPT +
          "\n\nDocument page: " +
          input.doc +
          "\n\nOCR markdown context:\n" +
          input.markdown.slice(0, 8000),
      },
      ...input.imageDataUrls.map((imageUrl) => ({
        type: "input_image",
        image_url: imageUrl,
        detail: this.imageDetail,
      })),
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
      max_output_tokens: Number.isFinite(this.maxOutputTokens) && this.maxOutputTokens > 0 ? this.maxOutputTokens : 6000,
    };
    if (this.reasoning !== "none") {
      body.reasoning = { effort: this.reasoning };
    }

    const controller = new AbortController();
    const timeoutMs = Number.isFinite(this.timeoutMs) && this.timeoutMs > 0 ? this.timeoutMs : 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.endpoint.replace(/\/$/u, "") + "/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("OpenAI OCR routing calibration timed out after " + String(timeoutMs) + "ms");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error("OpenAI OCR routing calibration failed: " + String(response.status) + " " + (await response.text()));
    }
    const text = extractResponseText(await response.json());
    return normalizeImageCaptionV2(JSON.parse(text));
  }
}

function readExistingOkResult(
  outputPath: string,
  sample: OcrCaptionBenchmarkSample,
  client: ImageCaptionV2Client,
  label: CalibrationHumanLabel | undefined,
): OcrCaptionRoutingCalibrationResult | null {
  if (!existsSync(outputPath)) {
    return null;
  }
  const parsed = readJsonFile<Record<string, unknown>>(outputPath);
  if (parsed.status !== "ok" || !parsed.caption) {
    return null;
  }
  const caption = normalizeImageCaptionV2(parsed.caption);
  const routing = routeImageCaptionV2(caption);
  const comparison = compareRoutingDecisionWithLabel(routing.route, label);
  return {
    sample,
    status: "ok",
    durationMs: Number(parsed.durationMs ?? 0),
    outputPath,
    provider: stringifyCaptionValue(parsed.provider) || client.provider,
    model: stringifyCaptionValue(parsed.model) || client.model,
    caption,
    routing,
    humanLabel: label,
    comparison,
  };
}

async function runOneSample(
  sample: OcrCaptionBenchmarkSample,
  sampleIndex: number,
  sampleCount: number,
  outputDir: string,
  client: ImageCaptionV2Client,
  label: CalibrationHumanLabel | undefined,
  onProgress: OcrCaptionRoutingCalibrationOptions["onProgress"],
): Promise<OcrCaptionRoutingCalibrationResult> {
  const startedAt = Date.now();
  const outputPath = path.join(outputDir, "results", stableSlug(sample.doc) + "." + stableSlug(client.model) + ".json");
  const existing = readExistingOkResult(outputPath, sample, client, label);
  if (existing) {
    onProgress?.({
      phase: "ok",
      sampleIndex,
      sampleCount,
      doc: sample.doc,
      model: client.model,
      durationMs: existing.durationMs,
      outputPath,
    });
    return existing;
  }
  onProgress?.({
    phase: "start",
    sampleIndex,
    sampleCount,
    doc: sample.doc,
    model: client.model,
  });
  try {
    const caption = await client.analyzePage({
      doc: sample.doc,
      markdown: sample.markdown,
      imageDataUrls: sample.imageDataUrls,
    });
    const routing = routeImageCaptionV2(caption);
    const comparison = compareRoutingDecisionWithLabel(routing.route, label);
    const durationMs = Date.now() - startedAt;
    const result: OcrCaptionRoutingCalibrationResult = {
      sample,
      status: "ok",
      durationMs,
      outputPath,
      provider: client.provider,
      model: client.model,
      caption,
      routing,
      humanLabel: label,
      comparison,
    };
    atomicWriteFile(outputPath, JSON.stringify(result, null, 2) + "\n");
    onProgress?.({
      phase: "ok",
      sampleIndex,
      sampleCount,
      doc: sample.doc,
      model: client.model,
      durationMs,
      outputPath,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const result: OcrCaptionRoutingCalibrationResult = {
      sample,
      status: "error",
      durationMs,
      outputPath,
      provider: client.provider,
      model: client.model,
      humanLabel: label,
      error: message,
    };
    atomicWriteFile(outputPath, JSON.stringify(result, null, 2) + "\n");
    onProgress?.({
      phase: "error",
      sampleIndex,
      sampleCount,
      doc: sample.doc,
      model: client.model,
      durationMs,
      outputPath,
      error: message,
    });
    return result;
  }
}

export async function runOcrCaptionRoutingCalibration(
  options: OcrCaptionRoutingCalibrationOptions,
): Promise<OcrCaptionRoutingCalibrationSummary> {
  const samples = selectCalibrationSamples(options);
  mkdirSync(options.outputDir, { recursive: true });
  const labels = readCalibrationLabels(options.labelsPath);
  const client = options.client ?? new OpenAIImageCaptionV2Client({ imageDetail: options.imageDetail });

  const results: OcrCaptionRoutingCalibrationResult[] = [];
  for (const [index, sample] of samples.entries()) {
    results.push(
      await runOneSample(
        sample,
        index + 1,
        samples.length,
        options.outputDir,
        client,
        labels.get(sample.doc),
        options.onProgress,
      ),
    );
  }

  const samplesPath = path.join(options.outputDir, "samples.json");
  const resultsPath = path.join(options.outputDir, "results.json");
  const reportPath = options.reportPath ?? path.join(options.outputDir, "REPORT.md");
  const metrics = computeMetrics(results);
  const summary: OcrCaptionRoutingCalibrationSummary = {
    model: client.model,
    sampleLimit: options.limit,
    sampleCount: samples.length,
    outputDir: options.outputDir,
    labelsPath: options.labelsPath ?? null,
    samplesPath,
    resultsPath,
    reportPath,
    metrics,
    decision: decideCalibration(metrics),
    results,
  };

  atomicWriteFile(samplesPath, JSON.stringify(samples, null, 2) + "\n");
  atomicWriteFile(resultsPath, JSON.stringify(summary, null, 2) + "\n");
  atomicWriteFile(reportPath, renderMarkdownReport(summary));

  return summary;
}
