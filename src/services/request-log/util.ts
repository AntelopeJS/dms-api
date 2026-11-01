import type { HTTPResult } from "@antelopejs/interface-api";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestLogBodyOmission } from "@/db/tables/request_log.table";
import { isBodyCarrier, isFunction, isNumber, isObject } from "@/guards";
import { HTTP_STATUS_OK } from "@/types/constants";
import {
  isSensitiveHeader,
  redactSearchParams,
  sanitizeBody,
} from "./redaction";

/**
 * The allow-listed headers, lower-cased. Allow-listed names that look like a
 * secret are never stored; they are added to `dropped` when given, so the
 * console can say which headers it left out.
 */
export function pickHeaders(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  allowList: ReadonlyArray<string>,
  dropped?: string[],
) {
  const out: Record<string, string> = {};
  const allow = new Set(allowList.map((h) => h.toLowerCase()));
  for (const [name, value] of Object.entries(headers)) {
    if (!allow.has(name.toLowerCase())) continue;
    if (value === undefined) continue;
    if (isSensitiveHeader(name)) {
      dropped?.push(name.toLowerCase());
      continue;
    }
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
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

/** No body stored, and why. */
export function omittedBody(reason: RequestLogBodyOmission): CapturedBody {
  return { truncated: false, omitted: reason, redacted: 0 };
}

function isEmptyBody(body: unknown): boolean {
  if (body === undefined || body === null || body === "") return true;
  return Buffer.isBuffer(body) && body.length === 0;
}

/**
 * The body to store, redacted and cut at `maxBytes`, or why it is not stored.
 * JSON and forms only: what the redaction can read by key.
 */
export function captureBody(
  body: unknown,
  contentType: string | undefined,
  maxBytes: number,
): CapturedBody {
  if (isEmptyBody(body)) return omittedBody("empty");
  if (maxBytes <= 0) return omittedBody("disabled");
  const sanitized = sanitizeBody(body, contentType ?? "");
  if (sanitized.text === undefined) {
    return omittedBody(sanitized.omitted ?? "not-json");
  }
  const { text, redacted } = sanitized;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > maxBytes) {
    return {
      body: utf8Prefix(bytes, maxBytes),
      truncated: true,
      redacted,
      size: bytes.length,
    };
  }
  return { body: text, truncated: false, redacted };
}

/**
 * The first `maxBytes` bytes of UTF-8 text, without a character cut in two: a
 * continuation byte (10xxxxxx) at the cut belongs to the character before it,
 * so the cut moves before that character's first byte.
 */
function utf8Prefix(bytes: Buffer, maxBytes: number): string {
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

/** The query of `url` as a record, redacted, and how many values were. */
export function queryToRecord(url: URL) {
  const { value: params, redacted } = redactSearchParams(url.searchParams);
  const query = Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length > 1 ? values : values[0]];
    }),
  );
  return { query, redacted };
}

/**
 * The status of a response or a thrown HTTPResult: its `getStatus()`, falling
 * through to `statusCode` then `status` when that throws or is missing, 200
 * otherwise.
 */
export function extractStatusCode(value: unknown): number {
  if (!isObject(value)) return HTTP_STATUS_OK;
  const v = value as {
    getStatus?: () => number;
    statusCode?: number;
    status?: number;
  };
  if (typeof v.getStatus === "function") {
    try {
      return v.getStatus();
    } catch {}
  }
  if (isNumber(v.statusCode)) return v.statusCode;
  if (isNumber(v.status)) return v.status;
  return HTTP_STATUS_OK;
}

export function extractBody(value: unknown): unknown {
  if (!isBodyCarrier(value)) return undefined;
  if (isFunction(value.getBody)) {
    try {
      return value.getBody();
    } catch {
      return undefined;
    }
  }
  return value.body;
}

export function extractContentType(value: HTTPResult): string | undefined {
  try {
    return value.getContentType();
  } catch {
    return undefined;
  }
}

export function extractHeaders(value: HTTPResult): Record<string, string> {
  try {
    return value.getHeaders();
  } catch {
    return {};
  }
}
