import type { IncomingMessage, ServerResponse } from "node:http";

import {
  getDefaultAiRuntime,
  type AiRuntime,
  type AiSourceV1Request,
  type SessionCookiePayload,
} from "../services/ai-orchestrator.ts";

export interface AiRouteResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly streamChunks?: readonly string[];
}

function toBadRequest(detail: string): AiRouteResponse {
  return {
    statusCode: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: { detail },
  };
}

export function validateAiRequestBody(body: unknown): body is AiSourceV1Request {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  if (candidate.provider !== undefined && typeof candidate.provider !== "string") {
    return false;
  }
  if (candidate.modelSelection !== undefined && typeof candidate.modelSelection !== "string") {
    return false;
  }
  if (
    candidate.complexitySelection !== undefined &&
    typeof candidate.complexitySelection !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(candidate.messages)) {
    return false;
  }

  return candidate.messages.every((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }
    const record = message as Record<string, unknown>;
    return typeof record.role === "string" && typeof record.text === "string";
  });
}

function parseCookies(rawCookieHeader: string | string[] | undefined): Record<string, string> {
  if (!rawCookieHeader) {
    return {};
  }

  const value = Array.isArray(rawCookieHeader) ? rawCookieHeader.join("; ") : rawCookieHeader;
  const cookies: Record<string, string> = {};
  for (const item of value.split(";")) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = decodeURIComponent(trimmed.slice(0, separatorIndex).trim());
    const cookieValue = decodeURIComponent(trimmed.slice(separatorIndex + 1).trim());
    cookies[key] = cookieValue;
  }
  return cookies;
}

function formatSetCookieHeader(cookie: SessionCookiePayload): string {
  const segments = [
    `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`,
    "Path=/",
    `Max-Age=${cookie.maxAge}`,
    `SameSite=${cookie.sameSite.charAt(0).toUpperCase()}${cookie.sameSite.slice(1)}`,
  ];
  if (cookie.httpOnly) {
    segments.push("HttpOnly");
  }
  return segments.join("; ");
}

function buildBridgeRequest(
  body: AiSourceV1Request,
  cookies?: Readonly<Record<string, string>>,
): { readonly body: AiSourceV1Request; readonly cookies?: Readonly<Record<string, string>> } {
  return {
    body: typeof body.provider === "string" ? body : { ...body, provider: "openai" },
    cookies,
  };
}

function wantsEventStream(acceptHeader: string | string[] | undefined): boolean {
  if (Array.isArray(acceptHeader)) {
    return acceptHeader.some((value) => value.includes("text/event-stream"));
  }
  return (acceptHeader ?? "").includes("text/event-stream");
}

export async function handleAiRoute(
  body: unknown,
  options: {
    readonly wantsStream: boolean;
    readonly runtime?: AiRuntime;
    readonly cookies?: Readonly<Record<string, string>>;
  },
): Promise<AiRouteResponse> {
  if (!validateAiRequestBody(body)) {
    return toBadRequest("invalid /ai request body");
  }

  if (body.messages.length === 0) {
    return toBadRequest("messages field required");
  }

  const runtime = options.runtime ?? getDefaultAiRuntime();
  const runtimeRequest = buildBridgeRequest(body, options.cookies);

  if (!options.wantsStream) {
    const result = await runtime.compute(runtimeRequest);
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": formatSetCookieHeader(result.sessionCookie),
    };
    return {
      statusCode: 200,
      headers,
      body: result.payload,
    };
  }

  const execution = await runtime.openStream(runtimeRequest);
  const streamChunks: string[] = [];
  for await (const chunk of execution.chunks) {
    streamChunks.push(chunk);
  }
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
      "set-cookie": formatSetCookieHeader(execution.sessionCookie),
    },
    streamChunks,
  };
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

function writeResponse(response: ServerResponse, result: AiRouteResponse): void {
  response.writeHead(result.statusCode, result.headers);
  if (result.streamChunks) {
    for (const chunk of result.streamChunks) {
      response.write(chunk);
    }
    response.end();
    return;
  }

  response.end(JSON.stringify(result.body));
}

export async function routeAiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime?: AiRuntime,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "POST" || url.pathname !== "/ai") {
    return false;
  }

  const rawBody = await readRequestBody(request);
  let parsedBody: unknown = {};

  try {
    parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : {};
  } catch {
    writeResponse(response, toBadRequest("invalid JSON body"));
    return true;
  }

  try {
    const cookies = parseCookies(request.headers.cookie);
    const activeRuntime = runtime ?? getDefaultAiRuntime();
    const wantsStream = wantsEventStream(request.headers.accept);

    if (wantsStream) {
      if (!validateAiRequestBody(parsedBody)) {
        writeResponse(response, toBadRequest("invalid /ai request body"));
        return true;
      }
      if (parsedBody.messages.length === 0) {
        writeResponse(response, toBadRequest("messages field required"));
        return true;
      }

      const execution = await activeRuntime.openStream(buildBridgeRequest(parsedBody, cookies));
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
        "set-cookie": formatSetCookieHeader(execution.sessionCookie),
      });
      try {
        for await (const chunk of execution.chunks) {
          response.write(chunk);
        }
        await execution.completed;
      } catch (error) {
        response.write(
          `event: error\ndata: ${JSON.stringify({
            type: "error",
            text: error instanceof Error ? error.message : "assistant stream failed",
            metadata: "final",
          })}\n\n`,
        );
        response.end();
        return true;
      }
      response.end();
      return true;
    }

    const result = await handleAiRoute(parsedBody, {
      wantsStream,
      runtime: activeRuntime,
      cookies,
    });
    writeResponse(response, result);
  } catch (error) {
    writeResponse(response, {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {
        detail: error instanceof Error ? error.message : "internal /ai route error",
      },
    });
  }

  return true;
}
