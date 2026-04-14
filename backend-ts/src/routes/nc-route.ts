import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import {
  getFileDataService,
  InvalidFilenameError,
  InvalidJsonFileError,
  type FileDataService,
} from "../services/file-data-service.ts";

interface JsonRouteResult {
  readonly statusCode: number;
  readonly body: unknown;
}

function badRequest(detail: string): JsonRouteResult {
  return { statusCode: 400, body: { detail } };
}

function json(response: ServerResponse, result: JsonRouteResult): void {
  response.writeHead(result.statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(result.body));
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

export async function handleNcJsonRoute(
  pathname: string,
  dataService: FileDataService = getFileDataService(),
): Promise<JsonRouteResult | null> {
  if (!pathname.startsWith("/nc/json/")) {
    return null;
  }

  const filename = decodeURIComponent(pathname.slice("/nc/json/".length));
  try {
    return {
      statusCode: 200,
      body: await dataService.getNcJson(filename),
    };
  } catch (error) {
    if (error instanceof InvalidFilenameError) {
      return badRequest("Invalid filename");
    }
    if (error instanceof InvalidJsonFileError) {
      return { statusCode: 500, body: { detail: "Invalid JSON file" } };
    }
    return {
      statusCode: 404,
      body: {
        detail: `File not found: ${path.join(dataService.config.ncJsonDir, filename)}`,
      },
    };
  }
}

export async function handleNcListRoute(
  searchParams: URLSearchParams,
  dataService: FileDataService = getFileDataService(),
): Promise<JsonRouteResult> {
  const maxRowsValue = searchParams.get("max_rows");
  const maxRows = maxRowsValue ? Number.parseInt(maxRowsValue, 10) : 500;
  const id = searchParams.get("id");

  return {
    statusCode: 200,
    body: await dataService.listNcRecords({
      maxRows: Number.isInteger(maxRows) && maxRows > 0 ? maxRows : 500,
      id,
    }),
  };
}

export async function handleNcDetailsRoute(
  body: unknown,
  dataService: FileDataService = getFileDataService(),
): Promise<JsonRouteResult> {
  if (!body || typeof body !== "object" || !Array.isArray((body as { nc_event_ids?: unknown }).nc_event_ids)) {
    return badRequest('Invalid payload: "nc_event_ids" should be a list.');
  }

  const identifiers = (body as { nc_event_ids: unknown[] }).nc_event_ids;
  const results = [];

  for (const value of identifiers) {
    if (typeof value !== "string" || value.includes("..") || value.includes("/")) {
      continue;
    }

    try {
      results.push(await dataService.getNcJson(`${value}.json`));
    } catch {
      continue;
    }
  }

  return {
    statusCode: 200,
    body: results,
  };
}

export async function routeNcRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dataService?: FileDataService,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/nc") {
    json(response, await handleNcListRoute(url.searchParams, dataService));
    return true;
  }

  if (request.method === "GET") {
    const ncJsonResult = await handleNcJsonRoute(url.pathname, dataService);
    if (ncJsonResult) {
      json(response, ncJsonResult);
      return true;
    }
  }

  if (request.method === "POST" && url.pathname === "/nc") {
    const rawBody = await readRequestBody(request);
    let parsedBody: unknown = {};
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : {};
    } catch {
      json(response, badRequest("Invalid JSON body."));
      return true;
    }

    json(response, await handleNcDetailsRoute(parsedBody, dataService));
    return true;
  }

  return false;
}
