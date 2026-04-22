import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { DataprepCorpusName } from "./pipeline.ts";

export interface KnowledgePublicArtifactsCorpus {
  readonly corpus: DataprepCorpusName;
  readonly outputRoot: string;
}

export interface KnowledgePublicArtifactsValidationOptions {
  readonly corpora: readonly KnowledgePublicArtifactsCorpus[];
}

export interface KnowledgePublicArtifactsCorpusReport {
  readonly corpus: DataprepCorpusName;
  readonly outputRoot: string;
  readonly imageCount: number;
  readonly imageRelationCount: number;
  readonly linkedImageCount: number;
}

export interface KnowledgePublicArtifactsValidationReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly corpora: readonly KnowledgePublicArtifactsCorpusReport[];
}

function readJsonArray(filePath: string, errors: string[]): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    errors.push(`missing required public artifact: ${filePath}`);
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      errors.push(`public artifact is not a JSON array: ${filePath}`);
      return [];
    }
    return parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"));
  } catch (error) {
    errors.push(`invalid public artifact JSON: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function linkedImagesFor(entry: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(entry.linked_images)
    ? entry.linked_images.filter((image): image is Record<string, unknown> => Boolean(image && typeof image === "object"))
    : [];
}

function normalizeWikiAssetPath(value: string): string | null {
  const normalized = value.replace(/^wiki\//u, "").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\\") || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

function listPublicSidecars(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const matches: string[] = [];
  for (const entry of readdirSync(root)) {
    const entryPath = path.join(root, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      matches.push(...listPublicSidecars(entryPath));
      continue;
    }
    if (/\.image-caption(?:\.audit)?\.json$/u.test(entry) || /\.batch(?:\.manifest)?\.json$/u.test(entry)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

function validateCorpus(corpus: KnowledgePublicArtifactsCorpus, errors: string[]): KnowledgePublicArtifactsCorpusReport {
  const ontologyRoot = path.join(corpus.outputRoot, "ontology");
  const wikiRoot = path.join(corpus.outputRoot, "wiki");
  const images = readJsonArray(path.join(ontologyRoot, "images.json"), errors);
  const imageRelations = readJsonArray(path.join(ontologyRoot, "image_relations.json"), errors);
  const wikiIndex = readJsonArray(path.join(wikiRoot, "index.json"), errors);
  const imageIds = new Set(images.map((image) => textValue(image.id)).filter((id): id is string => Boolean(id)));
  let linkedImageCount = 0;

  for (const relation of imageRelations) {
    const target = textValue(relation.to);
    const imageId = target?.replace(/^image:/u, "");
    if (imageId && !imageIds.has(imageId)) {
      errors.push(`${corpus.corpus}: image relation references missing image: ${target}`);
    }
  }

  for (const entry of wikiIndex) {
    for (const linkedImage of linkedImagesFor(entry)) {
      linkedImageCount += 1;
      const id = textValue(linkedImage.id);
      if (id && imageIds.size > 0 && !imageIds.has(id)) {
        errors.push(`${corpus.corpus}: wiki linked image is not present in ontology/images.json: ${id}`);
      }

      const assetPath = textValue(linkedImage.asset_path);
      if (!assetPath) {
        errors.push(`${corpus.corpus}: wiki linked image is missing asset_path on ${textValue(entry.slug) ?? "unknown entity"}`);
        continue;
      }
      const normalizedAssetPath = normalizeWikiAssetPath(assetPath);
      if (!normalizedAssetPath) {
        errors.push(`${corpus.corpus}: invalid linked image asset path: ${assetPath}`);
        continue;
      }
      if (!existsSync(path.join(wikiRoot, normalizedAssetPath))) {
        errors.push(`${corpus.corpus}: missing linked image asset: ${normalizedAssetPath}`);
      }
    }
  }

  for (const sidecar of [...listPublicSidecars(ontologyRoot), ...listPublicSidecars(wikiRoot)]) {
    errors.push(`${corpus.corpus}: raw batch/caption sidecar leaked into public artifacts: ${sidecar}`);
  }

  return {
    corpus: corpus.corpus,
    outputRoot: corpus.outputRoot,
    imageCount: images.length,
    imageRelationCount: imageRelations.length,
    linkedImageCount,
  };
}

export function validateKnowledgePublicArtifacts(
  options: KnowledgePublicArtifactsValidationOptions,
): KnowledgePublicArtifactsValidationReport {
  const errors: string[] = [];
  const corpora = options.corpora.map((corpus) => validateCorpus(corpus, errors));
  return {
    ok: errors.length === 0,
    errors,
    corpora,
  };
}
