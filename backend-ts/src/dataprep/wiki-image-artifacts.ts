import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { PreparedRecord } from "./pipeline.ts";
import {
  applyPageRetrievalPolicy,
  captionJsonPath,
  extractImageDataUrls,
  findOcrJsonPath,
  normalizeImageCaptionAnalysis,
  pageBaseFromDoc,
  readJsonFile,
  type ImageCaptionAnalysis,
  type OcrDocument,
} from "./ocr-tech-docs.ts";

export interface WikiImagePart {
  readonly slug: string;
  readonly canonical_name: string;
  readonly aliases: readonly string[];
  readonly supporting_docs: readonly string[];
}

export interface PublicWikiImage {
  readonly id: string;
  readonly doc: string;
  readonly doc_root: string;
  readonly image_index: number;
  readonly asset_path: string;
  readonly caption: string;
  readonly technical_description: string;
  readonly page_category: string;
  readonly figure_or_table_refs: readonly string[];
  readonly visible_identifiers: readonly string[];
  readonly part_or_zone_candidates: readonly string[];
  readonly relationships_or_flows: readonly string[];
  readonly retrieval_action: string;
}

export interface PublicWikiImageRelation {
  readonly from: string;
  readonly relation: "illustrated_by";
  readonly to: string;
  readonly doc: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface LinkedWikiImage extends PublicWikiImage {
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface BuildPublicWikiImageArtifactsOptions {
  readonly outputRoot: string;
  readonly ontologyRoot: string;
  readonly records: readonly PreparedRecord[];
  readonly parts: readonly WikiImagePart[];
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "")
    .replace(/-{2,}/gu, "-");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function safeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function docRootFromPageDoc(doc: string): string {
  return doc.replace(/_page_\d+.*$/u, ".pdf");
}

function readCaptionAnalyses(filePath: string): ImageCaptionAnalysis[] {
  const parsed = readJsonFile<unknown>(filePath);
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeImageCaptionAnalysis);
  }
  return [normalizeImageCaptionAnalysis(parsed)];
}

function enrichedMarkdownPath(ocrDir: string, pageDoc: string): string {
  return path.join(ocrDir, pageBaseFromDoc(pageDoc) + "__with_img_desc.md");
}

function imageAltTextsFromMarkdown(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[([^\]]+)\]\([^)]+\)/gu))
    .map((match) => match[1]?.replace(/\s+/gu, " ").trim() ?? "")
    .filter(Boolean);
}

function analysesFromEnrichedMarkdown(filePath: string): ImageCaptionAnalysis[] {
  if (!existsSync(filePath)) {
    return [];
  }
  return imageAltTextsFromMarkdown(readFileSync(filePath, "utf8")).map((caption) =>
    normalizeImageCaptionAnalysis({
      page_category: "technical_content",
      page_category_confidence: 0.6,
      is_non_content_page: false,
      retrieval_action: "index",
      retrieval_weight: 1,
      short_summary: caption,
      technical_description: caption,
      visible_text: [caption],
      visible_identifiers: [caption],
      part_or_zone_candidates: [caption],
      diagram_elements: [],
      relationships_or_flows: [],
      warnings_or_limits: [],
      figure_or_table_refs: [],
      uncertainties: ["Derived from enriched OCR markdown because raw caption sidecar is unavailable."],
    }),
  );
}

function readImageAnalyses(ocrDir: string, pageDoc: string): { analyses: ImageCaptionAnalysis[]; hasCaptionSidecar: boolean } {
  const captionPath = captionJsonPath(ocrDir, pageDoc);
  if (existsSync(captionPath)) {
    return { analyses: readCaptionAnalyses(captionPath), hasCaptionSidecar: true };
  }
  return {
    analyses: analysesFromEnrichedMarkdown(enrichedMarkdownPath(ocrDir, pageDoc)),
    hasCaptionSidecar: false,
  };
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/iu);
  if (!match) {
    return null;
  }
  return Buffer.from(match[2] ?? "", "base64");
}

function publicAssetName(doc: string, index: number): string {
  return `${slugify(pageBaseFromDoc(doc))}-${index + 1}.png`;
}

function imageCaption(analysis: ImageCaptionAnalysis): string {
  return (analysis.short_summary || analysis.technical_description).replace(/\s+/gu, " ").trim();
}

function lowerTexts(values: readonly string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

function textIncludesAny(text: string, aliases: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return aliases.some((alias) => {
    const candidate = alias.toLowerCase().trim();
    return candidate.length >= 3 && normalized.includes(candidate);
  });
}

function listIncludesAlias(values: readonly string[], aliases: readonly string[]): boolean {
  const normalizedValues = lowerTexts(values);
  return aliases.some((alias) => {
    const candidate = alias.toLowerCase().trim();
    return (
      candidate.length >= 3 &&
      normalizedValues.some((value) => value === candidate || value.includes(candidate) || candidate.includes(value))
    );
  });
}

function relationForPart(image: PublicWikiImage, part: WikiImagePart): PublicWikiImageRelation | null {
  const aliases = uniqueSorted([part.canonical_name, ...part.aliases, part.slug.replace(/-/gu, " ")]);
  const reasons: string[] = [];
  let score = 0;

  if (listIncludesAlias(image.part_or_zone_candidates, aliases)) {
    reasons.push("caption_candidate");
    score += 5;
  }
  if (listIncludesAlias(image.visible_identifiers, aliases)) {
    reasons.push("visible_identifier");
    score += 4;
  }
  if (textIncludesAny(image.technical_description, aliases) || textIncludesAny(image.caption, aliases)) {
    reasons.push("description_alias");
    score += 3;
  }
  if (part.supporting_docs.includes(image.doc)) {
    reasons.push("supporting_doc");
    score += 1;
  }
  if (image.figure_or_table_refs.length > 0) {
    reasons.push("figure_or_table_ref");
    score += 1;
  }
  if (image.relationships_or_flows.length > 0) {
    reasons.push("relationship_or_flow");
    score += 1;
  }

  const hasEntitySignal = reasons.some((reason) =>
    reason === "caption_candidate" || reason === "visible_identifier" || reason === "description_alias",
  );
  if (!hasEntitySignal || score < 3) {
    return null;
  }

  return {
    from: `part:${part.slug}`,
    relation: "illustrated_by",
    to: `image:${image.id}`,
    doc: image.doc,
    score,
    reasons: uniqueSorted(reasons),
  };
}

export function buildPublicWikiImageArtifacts(options: BuildPublicWikiImageArtifactsOptions): void {
  const ocrDir = path.join(options.outputRoot, "ocr");
  const assetRoot = path.join(options.ontologyRoot, "image-assets");
  rmSync(assetRoot, { recursive: true, force: true });
  mkdirSync(assetRoot, { recursive: true });

  const images: PublicWikiImage[] = [];
  const relations: PublicWikiImageRelation[] = [];
  const techRecords = options.records.filter((record) => record.corpus === "tech_docs");

  for (const record of techRecords) {
    const { analyses, hasCaptionSidecar } = readImageAnalyses(ocrDir, record.doc);
    if (analyses.length === 0) {
      continue;
    }
    const ocrPath = findOcrJsonPath(ocrDir, record.doc, hasCaptionSidecar);
    if (!ocrPath) {
      continue;
    }

    const ocrDocument = readJsonFile<OcrDocument>(ocrPath);
    const imageDataUrls = extractImageDataUrls(ocrDocument);
    if (imageDataUrls.length === 0) {
      continue;
    }

    for (const [index, dataUrl] of imageDataUrls.entries()) {
      const analysis = analyses[Math.min(index, analyses.length - 1)] ?? analyses[0];
      if (!analysis) {
        continue;
      }
      const policy = applyPageRetrievalPolicy(analysis);
      if (policy.action === "exclude") {
        continue;
      }

      const caption = imageCaption(analysis);
      const hasSignal =
        caption ||
        analysis.visible_identifiers.length > 0 ||
        analysis.part_or_zone_candidates.length > 0 ||
        analysis.relationships_or_flows.length > 0;
      if (!hasSignal) {
        continue;
      }

      const assetName = publicAssetName(record.doc, index);
      const buffer = dataUrlToBuffer(dataUrl);
      if (!buffer) {
        continue;
      }
      writeFileSync(path.join(assetRoot, assetName), buffer);

      images.push({
        id: assetName.replace(/\.png$/u, ""),
        doc: record.doc,
        doc_root: typeof record.metadata.doc_root === "string" ? record.metadata.doc_root : docRootFromPageDoc(record.doc),
        image_index: index,
        asset_path: `wiki/images/${assetName}`,
        caption,
        technical_description: analysis.technical_description,
        page_category: analysis.page_category,
        figure_or_table_refs: safeArray(analysis.figure_or_table_refs),
        visible_identifiers: safeArray(analysis.visible_identifiers),
        part_or_zone_candidates: safeArray(analysis.part_or_zone_candidates),
        relationships_or_flows: safeArray(analysis.relationships_or_flows),
        retrieval_action: policy.action,
      });
    }
  }

  images.sort((left, right) => left.id.localeCompare(right.id));
  for (const image of images) {
    for (const part of options.parts) {
      const relation = relationForPart(image, part);
      if (relation) {
        relations.push(relation);
      }
    }
  }
  relations.sort(
    (left, right) =>
      right.score - left.score ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      left.doc.localeCompare(right.doc),
  );

  writeFileSync(path.join(options.ontologyRoot, "images.json"), JSON.stringify(images, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(options.ontologyRoot, "image_relations.json"),
    JSON.stringify(relations, null, 2) + "\n",
    "utf8",
  );
}

export function readPublicWikiImages(ontologyRoot: string): PublicWikiImage[] {
  const filePath = path.join(ontologyRoot, "images.json");
  if (!existsSync(filePath)) {
    return [];
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as PublicWikiImage[];
}

export function readPublicWikiImageRelations(ontologyRoot: string): PublicWikiImageRelation[] {
  const filePath = path.join(ontologyRoot, "image_relations.json");
  if (!existsSync(filePath)) {
    return [];
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as PublicWikiImageRelation[];
}

export function copyPublicWikiImageAssets(ontologyRoot: string, wikiRoot: string): void {
  const assetRoot = path.join(ontologyRoot, "image-assets");
  const wikiImagesRoot = path.join(wikiRoot, "images");
  rmSync(wikiImagesRoot, { recursive: true, force: true });
  if (!existsSync(assetRoot)) {
    return;
  }
  const images = readPublicWikiImages(ontologyRoot);
  for (const image of images) {
    const assetName = path.basename(image.asset_path);
    const sourcePath = path.join(assetRoot, assetName);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(wikiImagesRoot, assetName);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath));
  }
}

export function linkedImagesForPart(
  partSlug: string,
  images: readonly PublicWikiImage[],
  relations: readonly PublicWikiImageRelation[],
  limit = 6,
): LinkedWikiImage[] {
  const imageById = new Map(images.map((image) => [`image:${image.id}`, image]));
  return relations
    .filter((relation) => relation.from === `part:${partSlug}`)
    .map((relation) => {
      const image = imageById.get(relation.to);
      if (!image) {
        return null;
      }
      return {
        ...image,
        asset_path: image.asset_path.replace(/^wiki\//u, ""),
        score: relation.score,
        reasons: relation.reasons,
      };
    })
    .filter((image): image is LinkedWikiImage => image !== null)
    .sort((left, right) => right.score - left.score || left.doc.localeCompare(right.doc) || left.id.localeCompare(right.id))
    .slice(0, limit);
}
