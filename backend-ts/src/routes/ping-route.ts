import { getRuntimeStatus } from "../services/runtime-status-service.ts";
import type { RouteResult } from "./route-result.ts";

export function resolvePingRoute(
  method: string | undefined,
  pathname: string,
): RouteResult | null {
  if (method !== "GET" || pathname !== "/ping") {
    return null;
  }

  return {
    statusCode: 200,
    body: getRuntimeStatus(),
  };
}
