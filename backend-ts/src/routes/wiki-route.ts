import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

export interface WikiRouteResult {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body:
    | Buffer
    | {
        readonly path?: string;
        readonly markdown?: string;
        readonly detail?: string;
      };
}

export interface WikiRouteOptions {
  readonly wikiRoot?: string;
}

function defaultWikiRoot(): string {
  return path.join(API_ROOT, "data", TECH_DOCS_DIR, "wiki");
}

function normalizeWikiPath(rawPath: string): string {
  const decoded = decodeURIComponent(rawPath).replace(/^\/+/, "").replace(/^wiki\//u, "");

  if (
    !decoded ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.startsWith("/") ||
    decoded.split("/").includes("..") ||
    (!decoded.endsWith(".md") && !isWikiImagePath(decoded))
  ) {
    throw new Error("Invalid wiki path");
  }

  return decoded;
}

function isWikiImagePath(value: string): boolean {
  return /^images\/[^/]+\.(?:png|jpe?g|webp)$/iu.test(value);
}

function imageContentType(value: string): string {
  if (/\.png$/iu.test(value)) {
    return "image/png";
  }
  if (/\.webp$/iu.test(value)) {
    return "image/webp";
  }
  return "image/jpeg";
}

export async function handleWikiRoute(
  pathname: string,
  options: WikiRouteOptions = {},
): Promise<WikiRouteResult | null> {
  if (!pathname.startsWith("/wiki/")) {
    return null;
  }

  let wikiPath: string;
  try {
    wikiPath = normalizeWikiPath(pathname.slice("/wiki/".length));
  } catch {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { detail: "Invalid wiki path" },
    };
  }

  const root = options.wikiRoot ?? defaultWikiRoot();
  const filePath = path.resolve(root, wikiPath);
  const resolvedRoot = path.resolve(root);
  if (!filePath.startsWith(resolvedRoot + path.sep)) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { detail: "Invalid wiki path" },
    };
  }

  if (!existsSync(filePath)) {
    return {
      statusCode: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { detail: "Wiki page not found" },
    };
  }

  if (isWikiImagePath(wikiPath)) {
    return {
      statusCode: 200,
      headers: { "content-type": imageContentType(wikiPath), "cache-control": "public, max-age=3600" },
      body: await readFile(filePath),
    };
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: {
      path: wikiPath,
      markdown: await readFile(filePath, "utf8"),
    },
  };
}

export async function routeWikiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options?: WikiRouteOptions,
): Promise<boolean> {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const result = await handleWikiRoute(url.pathname, options);
  if (!result) {
    return false;
  }

  response.writeHead(result.statusCode, result.headers);
  response.end(Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body));
  return true;
}
