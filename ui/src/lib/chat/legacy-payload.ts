import type {
  AiSourceGroup,
  AiSourceGroups,
  AiSourceV1Response,
} from "../../../../shared/ai-source-v1";

export type LegacySourceGroup = AiSourceGroup;
export type LegacySources = AiSourceGroups;
export type LegacyFinalPayload = Partial<AiSourceV1Response> & {
  reasoningSummary?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The legacy backend can return a JSON-looking string whose string values
 * contain literal newlines, which breaks JSON.parse on the client side.
 */
function escapeLiteralNewlinesInStrings(value: string): string {
  let normalized = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"' && !escaped) {
      inString = !inString;
      normalized += char;
      escaped = false;
      continue;
    }

    if (inString && (char === '\n' || char === '\r')) {
      if (char === '\r' && value[index + 1] === '\n') {
        index += 1;
      }

      normalized += '\\n';
      escaped = false;
      continue;
    }

    normalized += char;

    if (char === '\\' && !escaped) {
      escaped = true;
    } else {
      escaped = false;
    }
  }

  return normalized;
}

function parseEmbeddedJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    try {
      const parsed = JSON.parse(escapeLiteralNewlinesInStrings(trimmed));
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function normalizeLegacyFinalPayload(payload: LegacyFinalPayload): LegacyFinalPayload {
  const embeddedPayload = parseEmbeddedJsonObject(payload.text);

  if (payload.label || payload.description) {
    if (!embeddedPayload) {
      return payload;
    }

    return {
      ...payload,
      text:
        typeof embeddedPayload.comment === 'string'
          ? embeddedPayload.comment
          : undefined,
    };
  }

  if (!embeddedPayload) {
    return payload;
  }

  return {
    ...payload,
    text:
      typeof embeddedPayload.comment === 'string'
        ? embeddedPayload.comment
        : payload.text,
    label:
      typeof embeddedPayload.label === 'string'
        ? embeddedPayload.label
        : payload.label,
    description:
      embeddedPayload.description !== undefined
        ? embeddedPayload.description
        : payload.description,
  };
}
