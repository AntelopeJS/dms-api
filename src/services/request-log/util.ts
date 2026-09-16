import type { IncomingHttpHeaders } from "node:http";
import {
  HTTP_STATUS_OK,
  REQUEST_LOG_TEXT_CONTENT_TYPE_PREFIXES,
} from "@/types/constants";
import { isSensitiveKey, redactSearchParams, sanitizeBody } from "./redaction";

export function pickHeaders(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  allowList: ReadonlyArray<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const allow = new Set(allowList.map((h) => h.toLowerCase()));
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveKey(name)) continue;
    if (!allow.has(name.toLowerCase())) continue;
    if (value === undefined) continue;
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
}

export function captureBody(
  body: unknown,
  contentType: string | undefined,
  maxBytes: number,
): CapturedBody {
  if (body === undefined || body === null) {
    return { truncated: false };
  }
  if (!contentTypeIsText(contentType)) {
    return { truncated: false };
  }

  const text = sanitizeBody(body, contentType ?? "");
  if (text === undefined) return { truncated: false };

  if (text.length > maxBytes) {
    return { body: text.slice(0, maxBytes), truncated: true };
  }
  return { body: text, truncated: false };
}

export function queryToRecord(url: URL): Record<string, string | string[]> {
  const params = redactSearchParams(url.searchParams);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );
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
