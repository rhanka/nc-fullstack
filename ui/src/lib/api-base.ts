const DEFAULT_API_PORT = "8000";

function normalizeHostname(hostname: string): string {
  const normalized = hostname.replace(/^\[|\]$/g, "");

  if (!normalized || normalized === "0.0.0.0" || normalized === "::" || normalized === "::1") {
    return "localhost";
  }

  return normalized;
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return `http://localhost:${DEFAULT_API_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = normalizeHostname(window.location.hostname);

  return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
}
