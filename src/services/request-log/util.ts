import type { IncomingHttpHeaders } from "node:http";
import type { RequestLogBodyOmission } from "@/db/tables/request_log.table";
import {
  HTTP_STATUS_OK,
  REQUEST_LOG_TEXT_CONTENT_TYPE_PREFIXES,
} from "@/types/constants";
import { isSensitiveKey, redactSearchParams, sanitizeBody } from "./redaction";

/**
 * The allow-listed headers, lower-cased. Allow-listed names that look like a
 * secret are never stored; they are added to `dropped` when given, so the
 * console can say which headers it left out.
 */
export function pickHeaders(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  allowList: ReadonlyArray<string>,
  dropped?: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const allow = new Set(allowList.map((h) => h.toLowerCase()));
  for (const [name, value] of Object.entries(headers)) {
    if (!allow.has(name.toLowerCase())) continue;
    if (value === undefined) continue;
    if (isSensitiveKey(name)) {
      dropped?.push(name.toLowerCase());
      continue;
    }
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function contentTypeIsText(contentType?: string): boolean {
  if (!contentType) return false;
  const lc = contentType.toLowerCase();
  return REQUEST_LOG_TEXT_CONTENT_TYPE_PREFIXES.some((p) => lc.startsWith(p));
}

export interface CapturedBody {
  body?: string;
  truncated: boolean;
  /** Why no body is stored; absent when one is. */
  omitted?: RequestLogBodyOmission;
  /** Values the redaction replaced in the stored body. */
  redacted: number;
  /** Bytes of the whole body, when only its start is stored. */
  size?: number;
}

function omitted(reason: RequestLogBodyOmission): CapturedBody {
  return { truncated: false, omitted: reason, redacted: 0 };
}

function isEmptyBody(body: unknown): boolean {
  if (body === undefined || body === null || body === "") return true;
  return Buffer.isBuffer(body) && body.length === 0;
}

export function captureBody(
  body: unknown,
  contentType: string | undefined,
  maxBytes: number,
): CapturedBody {
  if (isEmptyBody(body)) return omitted("empty");
  if (maxBytes <= 0) return omitted("disabled");
  if (!contentTypeIsText(contentType)) return omitted("not-json");

  const sanitized = sanitizeBody(body, contentType ?? "");
  if (sanitized.text === undefined) {
    return omitted(sanitized.omitted ?? "not-json");
  }
  const { text, redacted } = sanitized;
  if (text.length > maxBytes) {
    return {
      body: text.slice(0, maxBytes),
      truncated: true,
      redacted,
      size: Buffer.byteLength(text),
    };
  }
  return { body: text, truncated: false, redacted };
}

/** The query of `url` as a record, redacted, and how many values were. */
export function queryToRecord(url: URL): {
  query: Record<string, string | string[]>;
  redacted: number;
} {
  const { value: params, redacted } = redactSearchParams(url.searchParams);
  const query = Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );
  return { query, redacted };
}

export function extractStatusCode(value: unknown): number {
  if (!value || typeof value !== "object") return HTTP_STATUS_OK;
  const v = value as {
    getStatus?: () => number;
    statusCode?: number;
    status?: number;
  };
  if (typeof v.getStatus === "function") {
    try {
      return v.getStatus();
    } catch {
      // fall through
    }
  }
  if (typeof v.statusCode === "number") return v.statusCode;
  if (typeof v.status === "number") return v.status;
  return HTTP_STATUS_OK;
}

export function extractBody(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const v = value as { getBody?: () => unknown; body?: unknown };
  if (typeof v.getBody === "function") {
    try {
      return v.getBody();
    } catch {
      return undefined;
    }
  }
  return v.body;
}

export function extractContentType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as { getContentType?: () => string };
  if (typeof v.getContentType === "function") {
    try {
      return v.getContentType();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function extractHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const v = value as { getHeaders?: () => Record<string, string> };
  if (typeof v.getHeaders === "function") {
    try {
      return v.getHeaders();
    } catch {
      return {};
    }
  }
  return {};
}
