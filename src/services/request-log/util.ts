import type { HTTPResult } from "@antelopejs/interface-api";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestLogBodyOmission } from "@/db/tables/request_log.table";
import {
  hasStatusGetter,
  isBodyCarrier,
  isFunction,
  isNumber,
  isObject,
} from "@/guards";
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

/**
 * The body to store, redacted and cut at `maxBytes`, or why it is not stored.
 * JSON and forms only: what the redaction can read by key.
 */
export function captureBody(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a response body is whatever a handler passed to HTTPResult (a string, a Buffer, any object, a value JSON cannot hold), and this function is where it is checked and parsed (sanitizeBody); a named type would only relabel unknown
  body: unknown,
  contentType: string | undefined,
  maxBytes: number,
): CapturedBody {
  if (body === undefined || body === null || body === "") {
    return omittedBody("empty");
  }
  if (Buffer.isBuffer(body) && body.length === 0) return omittedBody("empty");
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
 * through to `statusCode` then `status` when that throws or does not return a
 * number, 200 otherwise.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- value is a thrown value or a response of any shape, probed for getStatus, statusCode and status; HTTPResult cannot type it, as a thrown value may come from another copy of interface-api (tsc rejects HTTPResult for the capture.ts caller) and the tests feed non-objects
export function extractStatusCode(value: unknown): number {
  if (!isObject(value)) return HTTP_STATUS_OK;
  if (hasStatusGetter(value)) {
    try {
      const status: unknown = value.getStatus();
      if (isNumber(status)) return status;
    } catch {}
  }
  if ("statusCode" in value && isNumber(value.statusCode)) {
    return value.statusCode;
  }
  if ("status" in value && isNumber(value.status)) return value.status;
  return HTTP_STATUS_OK;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- value is a thrown value or a response probed for getBody and body (typing it HTTPResult fails tsc at the thrown-value caller in capture.ts), and the body it answers is whatever the handler set, which captureBody parses
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
