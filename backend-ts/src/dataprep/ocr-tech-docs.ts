import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

export const IMAGE_CAPTION_SCHEMA_VERSION = "a220_image_caption_v1";

const DEFAULT_PREPARED_CSV = "a220_tech_docs_content_prepared.csv.gz";
const DEFAULT_PREPARED_AUDIT = "a220_tech_docs_content_prepared.audit.json";

const TECHNICAL_PAGE_CATEGORIES = [
  "technical_diagram",
  "technical_table",
  "technical_photo",
  "technical_procedure",
] as const;

const NON_CONTENT_PAGE_CATEGORIES = [
  "index_page",
  "cover_page",
  "front_matter",
  "blank_page",
  "separation_page",
  "other_non_technical",
] as const;

export type TechnicalPageCategory = (typeof TECHNICAL_PAGE_CATEGORIES)[number];
export type NonContentPageCategory = (typeof NON_CONTENT_PAGE_CATEGORIES)[number];
export type PageCategory = TechnicalPageCategory | NonContentPageCategory | "unreadable";
export type RetrievalAction = "index" | "downweight" | "exclude";
export type OcrTechDocsMode = "existing" | "live";
export type OcrTechDocsCaptionMode = "off" | "missing" | "force";
export type ImageCaptionReasoning = "none" | "low";

export interface ImageCaptionAnalysis {
  readonly schema_version: typeof IMAGE_CAPTION_SCHEMA_VERSION;
  readonly page_category: PageCategory;
  readonly page_category_confidence: number;
  readonly is_non_content_page: boolean;
  readonly retrieval_action: RetrievalAction;
  readonly retrieval_weight: number;
  readonly short_summary: string;
  readonly technical_description: string;
  readonly visible_text: readonly string[];
  readonly visible_identifiers: readonly string[];
  readonly ata_candidates: readonly string[];
  readonly part_or_zone_candidates: readonly string[];
  readonly diagram_elements: readonly string[];
  readonly relationships_or_flows: readonly string[];
  readonly warnings_or_limits: readonly string[];
  readonly figure_or_table_refs: readonly string[];
  readonly uncertainties: readonly string[];
}

export interface PageRetrievalPolicy {
  readonly action: RetrievalAction;
  readonly weight: number;
  readonly reason: string;
}

export interface BuildPreparedTechDocsCsvOptions {
  readonly pagesDir: string;
  readonly ocrDir: string;
  readonly outputFile: string;
  readonly auditFile?: string;
  readonly chunkMaxChars?: number;
  readonly chunkOverlapChars?: number;
  readonly limit?: number;
}

export interface BuildPreparedTechDocsCsvResult {
  readonly mode: "existing";
  readonly pagesDir: string;
  readonly ocrDir: string;
  readonly outputFile: string;
  readonly auditFile: string | null;
  readonly pagesDiscovered: number;
  readonly ocrJsonRead: number;
  readonly captionJsonRead: number;
  readonly pagesIndexed: number;
  readonly pagesDownweighted: number;
  readonly pagesExcluded: number;
  readonly missingOcrPages: number;
  readonly rowsWritten: number;
  readonly enrichedJsonWritten: number;
  readonly enrichedMarkdownWritten: number;
  readonly chunkMaxChars: number;
  readonly chunkOverlapChars: number;
  readonly generatedAt: string;
  readonly errors: readonly string[];
}

export interface OcrGenerationResult {
  readonly pagesConsidered: number;
  readonly ocrJsonWritten: number;
  readonly ocrJsonSkipped: number;
  readonly captionJsonWritten: number;
  readonly captionJsonSkipped: number;
}

export interface RunOcrTechDocsDataprepOptions extends BuildPreparedTechDocsCsvOptions {
  readonly mode?: OcrTechDocsMode;
  readonly forceOcr?: boolean;
  readonly captionMode?: OcrTechDocsCaptionMode;
  readonly imageCaptionClient?: ImageCaptionClient;
  readonly mistralModel?: string;
}

export interface RunOcrTechDocsDataprepResult {
  readonly ocr: OcrGenerationResult;
  readonly csv: BuildPreparedTechDocsCsvResult;
}

export interface ImageCaptionClient {
  readonly provider: string;
  readonly model: string;
  analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionAnalysis>;
}

export interface ImageCaptionClientInput {
  readonly doc: string;
  readonly markdown: string;
  readonly imageDataUrls: readonly string[];
}

type OcrImage = {
  readonly id: string;
  readonly imageBase64?: string;
  readonly image_base64?: string;
};

type OcrPage = {
  readonly index?: number;
  readonly markdown?: string;
  readonly markdown_alt?: string;
  readonly images?: readonly OcrImage[];
};

type OcrDocument = {
  readonly pages?: readonly OcrPage[];
  readonly markdown?: string;
  readonly ocrResponse?: {
    readonly pages?: readonly OcrPage[];
  };
};

type PreparedRow = readonly [
  doc: string,
  docRoot: string,
  jsonData: string,
  chunk: string,
  length: string,
  chunkId: string,
  ata: string,
  parts: string,
  docType: string,
];

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteFile(filePath: string, content: string | Uint8Array): void {
  ensureParentDir(filePath);
  const tmpPath = filePath + ".tmp-" + String(process.pid);
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function isPageCategory(value: string): value is PageCategory {
  return (
    (TECHNICAL_PAGE_CATEGORIES as readonly string[]).includes(value) ||
    (NON_CONTENT_PAGE_CATEGORIES as readonly string[]).includes(value) ||
    value === "unreadable"
  );
}

function isNonContentCategory(value: PageCategory): boolean {
  return (NON_CONTENT_PAGE_CATEGORIES as readonly string[]).includes(value);
}

function isRetrievalAction(value: string): value is RetrievalAction {
  return value === "index" || value === "downweight" || value === "exclude";
}

export function normalizeImageCaptionAnalysis(value: unknown): ImageCaptionAnalysis {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawCategory = String(input.page_category ?? "technical_procedure").trim();
  const pageCategory: PageCategory = isPageCategory(rawCategory) ? rawCategory : "technical_procedure";
  const rawAction = String(input.retrieval_action ?? "index").trim();
  const retrievalAction: RetrievalAction = isRetrievalAction(rawAction) ? rawAction : "index";
  const confidence = clamp(Number(input.page_category_confidence ?? 0.5), 0, 1);
  const weight = clamp(Number(input.retrieval_weight ?? 1), 0, 1);
  return {
    schema_version: IMAGE_CAPTION_SCHEMA_VERSION,
    page_category: pageCategory,
    page_category_confidence: confidence,
    is_non_content_page:
      typeof input.is_non_content_page === "boolean" ? input.is_non_content_page : isNonContentCategory(pageCategory),
    retrieval_action: retrievalAction,
    retrieval_weight: weight,
    short_summary: String(input.short_summary ?? "").trim(),
    technical_description: String(input.technical_description ?? input.short_summary ?? "").trim(),
    visible_text: stringArray(input.visible_text),
    visible_identifiers: stringArray(input.visible_identifiers),
    ata_candidates: stringArray(input.ata_candidates),
    part_or_zone_candidates: stringArray(input.part_or_zone_candidates),
    diagram_elements: stringArray(input.diagram_elements),
    relationships_or_flows: stringArray(input.relationships_or_flows),
    warnings_or_limits: stringArray(input.warnings_or_limits),
    figure_or_table_refs: stringArray(input.figure_or_table_refs),
    uncertainties: stringArray(input.uncertainties),
  };
}

export function applyPageRetrievalPolicy(analysis: ImageCaptionAnalysis): PageRetrievalPolicy {
  if (analysis.page_category === "unreadable") {
    return { action: "exclude", weight: 0, reason: "unreadable-page" };
  }

  if (analysis.is_non_content_page || isNonContentCategory(analysis.page_category)) {
    if (analysis.page_category_confidence >= 0.75) {
      return { action: "exclude", weight: 0, reason: "high-confidence-non-content" };
    }
    if (analysis.page_category_confidence >= 0.55) {
      return { action: "downweight", weight: 0.15, reason: "medium-confidence-non-content" };
    }
    return { action: "downweight", weight: 0.4, reason: "low-confidence-non-content" };
  }

  if (analysis.retrieval_action === "exclude") {
    return { action: "exclude", weight: 0, reason: "caption-requested-exclusion" };
  }

  if (analysis.retrieval_action === "downweight") {
    return {
      action: "downweight",
      weight: Math.min(0.6, Math.max(0.05, analysis.retrieval_weight || 0.4)),
      reason: "caption-requested-downweight",
    };
  }

  if (analysis.page_category_confidence < 0.55) {
    return { action: "downweight", weight: 0.5, reason: "low-confidence-technical-classification" };
  }

  return { action: "index", weight: 1, reason: "technical-content" };
}

function sanitizeInlineText(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function captionText(analysis: ImageCaptionAnalysis): string {
  return sanitizeInlineText(analysis.technical_description || analysis.short_summary);
}

export function buildPageMarkdownWithImageDescriptions(
  markdown: string,
  analyses: readonly ImageCaptionAnalysis[],
): string {
  const captions = analyses
    .filter((analysis) => applyPageRetrievalPolicy(analysis).action !== "exclude")
    .map(captionText)
    .filter(Boolean);

  if (captions.length === 0) {
    return markdown;
  }

  let captionIndex = 0;
  const replaced = markdown.replace(/!\[[^\]]*\]\([^)]*\)/gu, () => {
    const caption = captions[Math.min(captionIndex, captions.length - 1)] ?? "";
    captionIndex += 1;
    return "> Image description: " + caption;
  });

  if (captionIndex > 0) {
    return replaced;
  }

  return (markdown.trimEnd() + "\n\n> Image description: " + captions.join("\n\n> Image description: ")).trimEnd();
}

function docRootFromPageDoc(doc: string): string {
  return doc.replace(/_page_\d+.*$/u, ".pdf");
}

function jsonNameFromPageDoc(doc: string): string {
  return doc.replace(/\.pdf$/iu, ".json");
}

function pageBaseFromDoc(doc: string): string {
  return doc.replace(/\.pdf$/iu, "");
}

function listPagePdfDocs(pagesDir: string, limit?: number): string[] {
  if (!existsSync(pagesDir)) {
    throw new Error("Missing tech docs pages directory: " + pagesDir);
  }
  const docs = readdirSync(pagesDir)
    .filter((entry) => entry.toLowerCase().endsWith(".pdf"))
    .sort((left, right) => left.localeCompare(right));
  return typeof limit === "number" && limit > 0 ? docs.slice(0, limit) : docs;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function captionJsonPath(ocrDir: string, pageDoc: string): string {
  return path.join(ocrDir, pageBaseFromDoc(pageDoc) + ".image-caption.json");
}

function rawOcrJsonPath(ocrDir: string, pageDoc: string): string {
  return path.join(ocrDir, pageBaseFromDoc(pageDoc) + ".json");
}

function enrichedOcrJsonPath(ocrDir: string, pageDoc: string): string {
  return path.join(ocrDir, pageBaseFromDoc(pageDoc) + "__with_img_desc.json");
}

function findOcrJsonPath(ocrDir: string, pageDoc: string, hasCaptionJson: boolean): string | null {
  const rawPath = rawOcrJsonPath(ocrDir, pageDoc);
  const enrichedPath = enrichedOcrJsonPath(ocrDir, pageDoc);
  if (hasCaptionJson && existsSync(rawPath)) {
    return rawPath;
  }
  if (existsSync(enrichedPath)) {
    return enrichedPath;
  }
  if (existsSync(rawPath)) {
    return rawPath;
  }
  return null;
}

function extractFirstPage(ocrDocument: OcrDocument): OcrPage | null {
  const pages = ocrDocument.pages ?? ocrDocument.ocrResponse?.pages ?? [];
  return pages[0] ?? null;
}

function extractMarkdown(ocrDocument: OcrDocument, preferAlt: boolean): string {
  const page = extractFirstPage(ocrDocument);
  if (!page) {
    return String(ocrDocument.markdown ?? "").trim();
  }
  if (preferAlt && page.markdown_alt) {
    return page.markdown_alt.trim();
  }
  return String(page.markdown ?? ocrDocument.markdown ?? "").trim();
}

function extractImageDataUrls(ocrDocument: OcrDocument): string[] {
  const page = extractFirstPage(ocrDocument);
  if (!page?.images) {
    return [];
  }
  return page.images
    .map((image) => image.imageBase64 ?? image.image_base64 ?? "")
    .map((value) => normalizeImageDataUrl(value))
    .filter(Boolean);
}

function normalizeImageDataUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  return "data:image/png;base64," + trimmed;
}

function readCaptionAnalyses(filePath: string): ImageCaptionAnalysis[] {
  const parsed = readJsonFile<unknown>(filePath);
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeImageCaptionAnalysis);
  }
  return [normalizeImageCaptionAnalysis(parsed)];
}

function inferDefaultAnalysis(markdown: string, doc: string): ImageCaptionAnalysis {
  const text = markdown.replace(/\s+/gu, " ").trim();
  const pageNumber = Number(doc.match(/_page_(\d+)/u)?.[1] ?? "0");
  const isBlank = text.length === 0;
  const looksLikeCover =
    pageNumber > 0 &&
    pageNumber <= 2 &&
    text.length < 1200 &&
    /\b(cover|training manual|manual|issue|revision|copyright|proprietary|table of contents)\b/iu.test(text);
  if (isBlank) {
    return normalizeImageCaptionAnalysis({
      page_category: "blank_page",
      page_category_confidence: 0.9,
      retrieval_action: "exclude",
      retrieval_weight: 0,
      short_summary: "Blank page.",
      technical_description: "",
    });
  }
  if (looksLikeCover) {
    return normalizeImageCaptionAnalysis({
      page_category: "front_matter",
      page_category_confidence: 0.7,
      retrieval_action: "downweight",
      retrieval_weight: 0.15,
      short_summary: "Likely manual front matter.",
      technical_description: "",
    });
  }
  return normalizeImageCaptionAnalysis({
    page_category: "technical_procedure",
    page_category_confidence: 0.6,
    retrieval_action: "index",
    retrieval_weight: 1,
    short_summary: "Technical document page.",
    technical_description: "",
  });
}

function encodeTsvField(value: string): string {
  if (/["\t\r\n\\]/u.test(value)) {
    return "\"" + value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"") + "\"";
  }
  return value;
}

function serializeTsvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((field) => encodeTsvField(field)).join("\t")).join("\n") + "\n";
}

function splitTextIntoChunks(value: string, maxChars: number, overlapChars: number): string[] {
  const clean = value.trim();
  if (!clean) {
    return [];
  }
  if (clean.length <= maxChars) {
    return [clean];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const searchStart = Math.max(start + Math.floor(maxChars * 0.5), end - 500);
      const boundary = Math.max(
        clean.lastIndexOf("\n\n", end),
        clean.lastIndexOf("\n", end),
        clean.lastIndexOf(" ", end),
      );
      if (boundary > searchStart) {
        end = boundary;
      }
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= clean.length) {
      break;
    }
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

function extractAta(markdown: string, analyses: readonly ImageCaptionAnalysis[]): string {
  const fromAnalysis = analyses.flatMap((analysis) => analysis.ata_candidates).find(Boolean);
  if (fromAnalysis) {
    return fromAnalysis;
  }
  const match = markdown.match(/\bATA[\s-]?(\d{2})\b/iu);
  return match ? "ATA " + match[1] : "";
}

function extractParts(analyses: readonly ImageCaptionAnalysis[]): string {
  return Array.from(
    new Set(analyses.flatMap((analysis) => analysis.part_or_zone_candidates).map((part) => part.trim()).filter(Boolean)),
  ).join("; ");
}

function writeEnrichedOcrArtifacts(
  ocrDir: string,
  doc: string,
  ocrDocument: OcrDocument,
  enrichedMarkdown: string,
  analyses: readonly ImageCaptionAnalysis[],
): { enrichedJsonWritten: number; enrichedMarkdownWritten: number } {
  const page = extractFirstPage(ocrDocument);
  const pages = ocrDocument.pages ?? ocrDocument.ocrResponse?.pages ?? [];
  const enrichedPages = pages.length > 0
    ? pages.map((candidate, index) => ({
        ...candidate,
        markdown_alt: index === 0 ? enrichedMarkdown : candidate.markdown_alt ?? candidate.markdown ?? "",
      }))
    : [
        {
          index: page?.index ?? 0,
          markdown: page?.markdown ?? enrichedMarkdown,
          images: page?.images ?? [],
          markdown_alt: enrichedMarkdown,
        },
      ];
  const enrichedDocument = {
    ...ocrDocument,
    pages: enrichedPages,
    image_caption_analyses: analyses,
  };
  const base = pageBaseFromDoc(doc);
  atomicWriteFile(path.join(ocrDir, base + "__with_img_desc.json"), JSON.stringify(enrichedDocument, null, 2) + "\n");
  atomicWriteFile(path.join(ocrDir, base + "__with_img_desc.md"), enrichedMarkdown.trimEnd() + "\n");
  return { enrichedJsonWritten: 1, enrichedMarkdownWritten: 1 };
}

function buildRowsForPage(
  doc: string,
  markdown: string,
  analyses: readonly ImageCaptionAnalysis[],
  maxChars: number,
  overlapChars: number,
): PreparedRow[] {
  const chunks = splitTextIntoChunks(markdown, maxChars, overlapChars);
  const docRoot = docRootFromPageDoc(doc);
  const jsonData = jsonNameFromPageDoc(doc);
  const ata = extractAta(markdown, analyses);
  const parts = extractParts(analyses);
  const docType = analyses[0]?.page_category ?? "technical_procedure";
  return chunks.map((chunk, index) => [
    doc,
    docRoot,
    jsonData,
    chunk,
    String(chunk.length),
    doc + " " + String(index),
    ata,
    parts,
    docType,
  ]);
}

export function getDefaultOcrTechDocsPaths(): BuildPreparedTechDocsCsvOptions {
  const root = path.join(API_ROOT, "data", TECH_DOCS_DIR);
  return {
    pagesDir: path.join(root, "pages"),
    ocrDir: path.join(root, "ocr"),
    outputFile: path.join(root, "managed_dataset", DEFAULT_PREPARED_CSV),
    auditFile: path.join(root, "managed_dataset", DEFAULT_PREPARED_AUDIT),
  };
}

export async function buildPreparedTechDocsCsvFromOcrArtifacts(
  options: BuildPreparedTechDocsCsvOptions,
): Promise<BuildPreparedTechDocsCsvResult> {
  const chunkMaxChars = options.chunkMaxChars ?? 3000;
  const chunkOverlapChars = options.chunkOverlapChars ?? 120;
  const docs = listPagePdfDocs(options.pagesDir, options.limit);
  const rows: PreparedRow[] = [
    ["doc", "doc_root", "json_data", "chunk", "length", "chunk_id", "ata", "parts", "doc_type"],
  ];

  let ocrJsonRead = 0;
  let captionJsonRead = 0;
  let pagesIndexed = 0;
  let pagesDownweighted = 0;
  let pagesExcluded = 0;
  let missingOcrPages = 0;
  let enrichedJsonWritten = 0;
  let enrichedMarkdownWritten = 0;
  const errors: string[] = [];

  for (const doc of docs) {
    try {
      const captionPath = captionJsonPath(options.ocrDir, doc);
      const hasCaptionJson = existsSync(captionPath);
      const ocrPath = findOcrJsonPath(options.ocrDir, doc, hasCaptionJson);
      if (!ocrPath) {
        missingOcrPages += 1;
        continue;
      }

      const ocrDocument = readJsonFile<OcrDocument>(ocrPath);
      ocrJsonRead += 1;
      const captionAnalyses = hasCaptionJson ? readCaptionAnalyses(captionPath) : [];
      if (hasCaptionJson) {
        captionJsonRead += 1;
      }

      const rawMarkdown = extractMarkdown(ocrDocument, captionAnalyses.length === 0);
      const analyses = captionAnalyses.length > 0 ? captionAnalyses : [inferDefaultAnalysis(rawMarkdown, doc)];
      const pagePolicy = applyPageRetrievalPolicy(analyses[0]!);
      if (pagePolicy.action === "exclude") {
        pagesExcluded += 1;
        continue;
      }
      if (pagePolicy.action === "downweight") {
        pagesDownweighted += 1;
      }

      const enrichedMarkdown =
        captionAnalyses.length > 0 ? buildPageMarkdownWithImageDescriptions(rawMarkdown, analyses) : rawMarkdown;
      if (captionAnalyses.length > 0) {
        const enrichedCounts = writeEnrichedOcrArtifacts(options.ocrDir, doc, ocrDocument, enrichedMarkdown, analyses);
        enrichedJsonWritten += enrichedCounts.enrichedJsonWritten;
        enrichedMarkdownWritten += enrichedCounts.enrichedMarkdownWritten;
      }
      const pageRows = buildRowsForPage(doc, enrichedMarkdown, analyses, chunkMaxChars, chunkOverlapChars);
      if (pageRows.length === 0) {
        pagesExcluded += 1;
        continue;
      }
      rows.push(...pageRows);
      pagesIndexed += 1;
    } catch (error) {
      errors.push(doc + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const csvText = serializeTsvRows(rows);
  atomicWriteFile(options.outputFile, gzipSync(csvText));
  const result: BuildPreparedTechDocsCsvResult = {
    mode: "existing",
    pagesDir: options.pagesDir,
    ocrDir: options.ocrDir,
    outputFile: options.outputFile,
    auditFile: options.auditFile ?? null,
    pagesDiscovered: docs.length,
    ocrJsonRead,
    captionJsonRead,
    pagesIndexed,
    pagesDownweighted,
    pagesExcluded,
    missingOcrPages,
    rowsWritten: rows.length - 1,
    enrichedJsonWritten,
    enrichedMarkdownWritten,
    chunkMaxChars,
    chunkOverlapChars,
    generatedAt: new Date().toISOString(),
    errors,
  };

  if (options.auditFile) {
    atomicWriteFile(options.auditFile, JSON.stringify(result, null, 2) + "\n");
  }

  return result;
}

export const A220_IMAGE_CAPTION_PROMPT = [
  "You are preparing an A220 technical documentation page for retrieval augmented generation.",
  "Return JSON only using schema version a220_image_caption_v1.",
  "Classify cover pages, index pages, front matter, blank pages, separation pages and unreadable pages so they do not pollute recall.",
  "You receive OCR-extracted image crops plus OCR Markdown context; you do not receive a full PDF page render.",
  "For technical diagrams, produce a deep description of the extracted image: components, labels, directions, flows, geometry, ATA candidates, part or zone candidates, and any warning or limit visible in the image or OCR context.",
  "Do not invent identifiers. Preserve visible ATA, part numbers, zones and figure references exactly when readable.",
  "Required JSON keys: schema_version, page_category, page_category_confidence, is_non_content_page, retrieval_action, retrieval_weight, short_summary, technical_description, visible_text, visible_identifiers, ata_candidates, part_or_zone_candidates, diagram_elements, relationships_or_flows, warnings_or_limits, figure_or_table_refs, uncertainties.",
  "Allowed page_category values: technical_diagram, technical_table, technical_photo, technical_procedure, index_page, cover_page, front_matter, blank_page, separation_page, other_non_technical, unreadable.",
  "retrieval_action must be index, downweight or exclude.",
].join("\n");

function extractResponseText(payload: unknown): string {
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

export class OpenAIImageCaptionClient implements ImageCaptionClient {
  readonly provider = "openai";
  readonly model: string;
  readonly apiKey: string;
  readonly endpoint: string;
  readonly imageDetail: string;
  readonly reasoning: ImageCaptionReasoning;

  constructor(options: {
    readonly apiKey?: string;
    readonly model?: string;
    readonly endpoint?: string;
    readonly imageDetail?: string;
    readonly reasoning?: ImageCaptionReasoning;
  } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.IMAGE_CAPTION_MODEL ?? "gpt-5.4";
    this.endpoint = options.endpoint ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.imageDetail = options.imageDetail ?? process.env.IMAGE_CAPTION_DETAIL ?? "original";
    this.reasoning = options.reasoning ?? (process.env.IMAGE_CAPTION_REASONING as ImageCaptionReasoning | undefined) ?? "none";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for image captioning");
    }
  }

  async analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionAnalysis> {
    const content = [
      {
        type: "input_text",
        text:
          A220_IMAGE_CAPTION_PROMPT +
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
      max_output_tokens: 2200,
    };
    if (this.reasoning !== "none") {
      body.reasoning = { effort: this.reasoning };
    }

    const response = await fetch(this.endpoint.replace(/\/$/u, "") + "/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error("OpenAI image captioning failed: " + String(response.status) + " " + (await response.text()));
    }
    const text = extractResponseText(await response.json());
    return normalizeImageCaptionAnalysis(JSON.parse(text));
  }
}

export class GeminiImageCaptionClient implements ImageCaptionClient {
  readonly provider = "gemini";
  readonly model: string;
  readonly apiKey: string;
  readonly endpoint: string;

  constructor(options: { readonly apiKey?: string; readonly model?: string; readonly endpoint?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.model = options.model ?? process.env.IMAGE_CAPTION_FALLBACK_MODEL ?? "gemini-3.1-pro-preview";
    this.endpoint = options.endpoint ?? "https://generativelanguage.googleapis.com/v1beta";
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is required for Gemini image captioning");
    }
  }

  async analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionAnalysis> {
    const parts = [
      {
        text:
          A220_IMAGE_CAPTION_PROMPT +
          "\n\nDocument page: " +
          input.doc +
          "\n\nOCR markdown context:\n" +
          input.markdown.slice(0, 8000),
      },
      ...input.imageDataUrls.map((imageUrl) => {
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/u);
        return {
          inline_data: {
            mime_type: match?.[1] ?? "image/png",
            data: match?.[2] ?? imageUrl,
          },
        };
      }),
    ];
    const response = await fetch(
      this.endpoint.replace(/\/$/u, "") + "/models/" + encodeURIComponent(this.model) + ":generateContent?key=" + encodeURIComponent(this.apiKey),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!response.ok) {
      throw new Error("Gemini image captioning failed: " + String(response.status) + " " + (await response.text()));
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return normalizeImageCaptionAnalysis(JSON.parse(text));
  }
}

export function createImageCaptionClientFromEnv(): ImageCaptionClient {
  const provider = (process.env.IMAGE_CAPTION_PROVIDER ?? "openai").trim().toLowerCase();
  if (provider === "gemini" || provider === "google") {
    return new GeminiImageCaptionClient();
  }
  return new OpenAIImageCaptionClient();
}

async function generateOcrArtifactsFromPagePdfs(
  options: RunOcrTechDocsDataprepOptions,
  docs: readonly string[],
): Promise<{ ocrJsonWritten: number; ocrJsonSkipped: number }> {
  const imported = (await import("mistral-ocr")) as {
    convertPdf: (
      input: string,
      options?: {
        model?: string;
        generateDocx?: boolean;
        logger?: false;
      },
    ) => Promise<{ ocrResponse: unknown }>;
  };
  mkdirSync(options.ocrDir, { recursive: true });
  let ocrJsonWritten = 0;
  let ocrJsonSkipped = 0;
  for (const doc of docs) {
    const outputPath = rawOcrJsonPath(options.ocrDir, doc);
    if (!options.forceOcr && existsSync(outputPath)) {
      ocrJsonSkipped += 1;
      continue;
    }
    const pdfPath = path.join(options.pagesDir, doc);
    const result = await imported.convertPdf(pdfPath, {
      model: options.mistralModel ?? process.env.MISTRAL_OCR_MODEL ?? "mistral-ocr-latest",
      generateDocx: false,
      logger: false,
    });
    atomicWriteFile(outputPath, JSON.stringify(result.ocrResponse, null, 2) + "\n");
    ocrJsonWritten += 1;
  }
  return { ocrJsonWritten, ocrJsonSkipped };
}

async function generateImageCaptionArtifacts(
  options: RunOcrTechDocsDataprepOptions,
  docs: readonly string[],
): Promise<{ captionJsonWritten: number; captionJsonSkipped: number }> {
  const captionMode = options.captionMode ?? "off";
  if (captionMode === "off") {
    return { captionJsonWritten: 0, captionJsonSkipped: docs.length };
  }
  const client = options.imageCaptionClient ?? createImageCaptionClientFromEnv();
  let captionJsonWritten = 0;
  let captionJsonSkipped = 0;
  for (const doc of docs) {
    const outputPath = captionJsonPath(options.ocrDir, doc);
    if (captionMode === "missing" && existsSync(outputPath)) {
      captionJsonSkipped += 1;
      continue;
    }
    const ocrPath = findOcrJsonPath(options.ocrDir, doc, false);
    if (!ocrPath) {
      captionJsonSkipped += 1;
      continue;
    }
    const ocrDocument = readJsonFile<OcrDocument>(ocrPath);
    const markdown = extractMarkdown(ocrDocument, true);
    const imageDataUrls = extractImageDataUrls(ocrDocument);
    const analysis =
      imageDataUrls.length > 0
        ? await client.analyzePage({ doc, markdown, imageDataUrls })
        : inferDefaultAnalysis(markdown, doc);
    atomicWriteFile(outputPath, JSON.stringify(analysis, null, 2) + "\n");
    captionJsonWritten += 1;
  }
  return { captionJsonWritten, captionJsonSkipped };
}

export async function runOcrTechDocsDataprep(
  options: RunOcrTechDocsDataprepOptions = getDefaultOcrTechDocsPaths(),
): Promise<RunOcrTechDocsDataprepResult> {
  const mode = options.mode ?? "existing";
  const docs = listPagePdfDocs(options.pagesDir, options.limit);
  const ocrCounts =
    mode === "live"
      ? await generateOcrArtifactsFromPagePdfs(options, docs)
      : { ocrJsonWritten: 0, ocrJsonSkipped: docs.length };
  const captionCounts = await generateImageCaptionArtifacts(options, docs);
  const csv = await buildPreparedTechDocsCsvFromOcrArtifacts(options);
  return {
    ocr: {
      pagesConsidered: docs.length,
      ...ocrCounts,
      ...captionCounts,
    },
    csv,
  };
}
