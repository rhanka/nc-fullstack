import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const API_ROOT = path.join(REPO_ROOT, "api");

export interface FileDataServiceConfig {
  readonly techDocsPagesDir: string;
  readonly ncJsonDir: string;
  readonly ataCodesPath: string;
}

export interface NcRecord extends Record<string, unknown> {
  readonly doc: string;
  readonly nc_event_id: string;
  readonly analysis_history: Record<string, unknown>;
  readonly ATA_code?: string;
  readonly ATA_category?: string;
}

export class InvalidFilenameError extends Error {
  constructor() {
    super("Invalid filename");
  }
}

export class InvalidJsonFileError extends Error {
  constructor() {
    super("Invalid JSON file");
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      ((error as { code?: string }).code === "ENOENT" || (error as { code?: string }).code === "ENOTDIR"),
  );
}

export function getDefaultFileDataConfig(): FileDataServiceConfig {
  const techDocsDirName = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";
  const ncDirName = process.env.NC_DIR?.trim() || "a220-non-conformities";

  return {
    techDocsPagesDir: path.join(API_ROOT, "data", techDocsDirName, "pages"),
    ncJsonDir: path.join(API_ROOT, "data", ncDirName, "json"),
    ataCodesPath: path.join(API_ROOT, "src", "ata_codes.json"),
  };
}

function isUnsafeFilename(filename: string): boolean {
  return filename.includes("..") || filename.startsWith("/") || filename.includes(path.sep);
}

export class FileDataService {
  readonly #config: FileDataServiceConfig;
  readonly #ataCategories: Map<string, string>;
  #ataCategoriesLoaded = false;

  constructor(config: Partial<FileDataServiceConfig> = {}) {
    this.#config = {
      ...getDefaultFileDataConfig(),
      ...config,
    };
    this.#ataCategories = new Map();
  }

  get config(): FileDataServiceConfig {
    return this.#config;
  }

  async #ensureAtaCategories(): Promise<void> {
    if (this.#ataCategoriesLoaded) {
      return;
    }

    this.#ataCategoriesLoaded = true;
    try {
      const raw = await readFile(this.#config.ataCodesPath, "utf8");
      const items = JSON.parse(raw) as Array<{ ATA_code: string; ATA_category: string }>;
      for (const item of items) {
        this.#ataCategories.set(item.ATA_code, item.ATA_category);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      console.error("Failed to load ATA codes:", error);
    }
  }

  async getDocument(filename: string): Promise<{ readonly filePath: string; readonly content: Buffer }> {
    if (isUnsafeFilename(filename)) {
      throw new InvalidFilenameError();
    }

    const filePath = path.join(this.#config.techDocsPagesDir, filename);
    const content = await readFile(filePath);
    return { filePath, content };
  }

  async getNcJson(filename: string): Promise<NcRecord> {
    if (isUnsafeFilename(filename)) {
      throw new InvalidFilenameError();
    }

    await this.#ensureAtaCategories();
    const filePath = path.join(this.#config.ncJsonDir, filename);
    const raw = await readFile(filePath, "utf8");
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      return this.enrichWithAta(payload, filename);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidJsonFileError();
      }
      throw error;
    }
  }

  async listNcRecords(options: { readonly maxRows: number; readonly id?: string | null }): Promise<NcRecord[]> {
    await this.#ensureAtaCategories();
    let entries: string[] = [];
    try {
      entries = await readdir(this.#config.ncJsonDir);
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }
      throw error;
    }
    const filenames = entries.filter((entry) => entry.endsWith(".json")).sort();
    const selected = options.id ? filenames : filenames.slice(0, options.maxRows);

    const records: NcRecord[] = [];
    for (const filename of selected) {
      const filePath = path.join(this.#config.ncJsonDir, filename);
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        continue;
      }

      try {
        const raw = await readFile(filePath, "utf8");
        const payload = JSON.parse(raw) as Record<string, unknown>;
        const enriched = this.enrichWithAta(payload, filename);
        if (!options.id || String(enriched.nc_event_id) === options.id) {
          records.push(enriched);
        }
      } catch {
        continue;
      }
    }

    return options.id ? records : records.slice(0, options.maxRows);
  }

  enrichWithAta(payload: Record<string, unknown>, filename: string): NcRecord {
    const doc = filename.replace(/\.json$/u, "");
    const match = /^ATA-(\d{2})/u.exec(filename);
    const ataCode = match ? `ATA-${match[1]}` : undefined;

    return {
      doc,
      nc_event_id: doc,
      analysis_history: payload,
      ...(ataCode
        ? {
            ATA_code: ataCode,
            ATA_category: this.#ataCategories.get(ataCode) ?? "Unknown",
          }
        : {}),
    };
  }
}

let defaultFileDataService: FileDataService | null = null;

export function getFileDataService(): FileDataService {
  if (!defaultFileDataService) {
    defaultFileDataService = new FileDataService();
  }
  return defaultFileDataService;
}
