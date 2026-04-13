import type { IncomingMessage, ServerResponse } from "node:http";

import { getFileDataService, type FileDataService } from "../services/file-data-service.ts";

export interface DocRouteResult {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Buffer | { readonly detail: string };
}

function encodeFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/['()]/gu, escape).replace(/\*/gu, "%2A");
}

export async function handleDocRoute(
  pathname: string,
  dataService: FileDataService = getFileDataService(),
): Promise<DocRouteResult | null> {
  if (!pathname.startsWith("/doc/")) {
    return null;
  }

  const filename = decodeURIComponent(pathname.slice("/doc/".length));

  try {
    const document = await dataService.getDocument(filename);
    void document.filePath;
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename*=UTF-8''${encodeFilename(filename)}`,
      },
      body: document.content,
    };
  } catch (error) {
    return {
      statusCode: error instanceof Error && error.message === "Invalid filename" ? 400 : 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {
        detail: error instanceof Error && error.message === "Invalid filename" ? "Invalid filename" : "File not found",
      },
    };
  }
}

export async function routeDocRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dataService?: FileDataService,
): Promise<boolean> {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const result = await handleDocRoute(url.pathname, dataService);
  if (!result) {
    return false;
  }

  response.writeHead(result.statusCode, result.headers);
  if (Buffer.isBuffer(result.body)) {
    response.end(result.body);
  } else {
    response.end(JSON.stringify(result.body));
  }
  return true;
}
