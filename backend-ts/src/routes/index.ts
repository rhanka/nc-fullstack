import type { IncomingMessage, ServerResponse } from "node:http";

import { routeAiRequest } from "./ai-route.ts";
import { routeDocRequest } from "./doc-route.ts";
import { routeNcRequest } from "./nc-route.ts";
import { routeWikiRequest } from "./wiki-route.ts";
import { resolvePingRoute } from "./ping-route.ts";
import type { RouteResult } from "./route-result.ts";
import type { AiRuntime } from "../services/ai-orchestrator.ts";
import type { FileDataService } from "../services/file-data-service.ts";

export interface RouteRequestOptions {
  readonly aiRuntime?: AiRuntime;
  readonly dataService?: FileDataService;
}

const ALLOWED_EXACT_CORS_ORIGINS = new Set([
  "https://nc.sent-tech.ca",
]);

const ALLOWED_LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
}

function setHeader(response: ServerResponse, name: string, value: string): void {
  response.setHeader(name, value);
}

function isAllowedCorsOrigin(origin: string): boolean {
  if (ALLOWED_EXACT_CORS_ORIGINS.has(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    return (url.protocol === "http:" || url.protocol === "https:") && ALLOWED_LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = readHeaderValue(request.headers.origin);
  if (!origin || !isAllowedCorsOrigin(origin)) {
    return false;
  }

  setHeader(response, "vary", "Origin");
  setHeader(response, "access-control-allow-origin", origin);
  setHeader(response, "access-control-allow-credentials", "true");

  if (request.method !== "OPTIONS") {
    return false;
  }

  const requestedHeaders = readHeaderValue(request.headers["access-control-request-headers"]);
  setHeader(response, "access-control-allow-methods", "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT");
  setHeader(response, "access-control-allow-headers", requestedHeaders || "*");
  response.writeHead(204, {});
  response.end();
  return true;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function resolveRoute(method: string | undefined, rawUrl: string | undefined): RouteResult {
  const url = new URL(rawUrl ?? "/", "http://127.0.0.1");
  const pingRoute = resolvePingRoute(method, url.pathname);

  if (pingRoute) {
    return pingRoute;
  }

  return {
    statusCode: 404,
    body: {
      status: "not_found",
      path: url.pathname,
    },
  };
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RouteRequestOptions = {},
): Promise<void> {
  if (applyCors(request, response)) {
    return;
  }
  if (await routeAiRequest(request, response, options.aiRuntime)) {
    return;
  }
  if (await routeNcRequest(request, response, options.dataService)) {
    return;
  }
  if (await routeWikiRequest(request, response)) {
    return;
  }
  if (await routeDocRequest(request, response, options.dataService)) {
    return;
  }

  const result = resolveRoute(request.method, request.url);
  writeJson(response, result.statusCode, result.body);
}
