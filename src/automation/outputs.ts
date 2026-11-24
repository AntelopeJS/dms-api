import type { JsonSchema } from "@antelopejs/interface-dms-automation";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";
import { requestLink, routeRef } from "@/services/links";
import { parseRouteRef } from "@/services/route-catalog";
import { WINDOW_PRESETS } from "@/services/window";

/** Longest error message a node hands on. */
export const MESSAGE_MAX_LENGTH = 300;

/** Longest `METHOD /path` ref a node takes. */
export const ROUTE_REF_MAX_LENGTH = 2100;

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export const VERDICTS = [
  "operational",
  "degraded",
  "down",
  "recovered",
  "idle",
] as const;

/** `message` cut to {@link MESSAGE_MAX_LENGTH} characters, `…` marking the cut. */
export function truncateMessage(
  message: string | null | undefined,
): string | null {
  if (message === null || message === undefined) return null;
  return message.length > MESSAGE_MAX_LENGTH
    ? `${message.slice(0, MESSAGE_MAX_LENGTH)}…`
    : message;
}

/** A schema accepting `type` or null. */
export function nullable(type: string, extra: JsonSchema = {}): JsonSchema {
  return { ...extra, type: [type, "null"] };
}

/** An object schema whose every property is required. */
export function objectSchema(
  properties: Record<string, JsonSchema>,
  extra: JsonSchema = {},
): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    ...extra,
  };
}

/** A `METHOD /path` input. */
export function routeRefInput(description: string): JsonSchema {
  return {
    type: "string",
    title: "Route",
    description,
    maxLength: ROUTE_REF_MAX_LENGTH,
    pattern: "^[A-Za-z]+ /\\S*$",
  };
}

export const PERIOD_INPUT: JsonSchema = {
  type: "string",
  title: "Period",
  enum: [...WINDOW_PRESETS],
};

export const DATE_TIME: JsonSchema = { type: "string", format: "date-time" };

/** A path prefix input, as the route filters take it. */
export const PATH_PREFIX_INPUT: JsonSchema = {
  type: "string",
  title: "Path prefix",
  maxLength: 512,
  pattern: "^/",
};

/**
 * The method and canonical path a `METHOD /path` ref names. A step given
 * anything else fails.
 */
export function requireRouteRef(ref: string) {
  const parsed = parseRouteRef(ref);
  if (!parsed) throw new Error(`"${ref}" is not a METHOD /path route`);
  return { ...parsed, ref: routeRef(parsed.method, parsed.path) };
}

/** A date input, or undefined when not given. A step given a non-date fails. */
export function dateInput(
  name: string,
  value: string | undefined,
): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} is not a date: "${value}"`);
  }
  return date;
}

/** A captured request as every node hands it on: no headers, bodies, query, client or stack. */
export type RequestSummary = {
  id: string;
  timestamp: string;
  method: string;
  routeMethod: string | null;
  uri: string;
  route: string | null;
  statusCode: number;
  responseTimeMs: number | null;
  errorMessage: string | null;
  requestId: string | null;
  source: string | null;
  consolePath: string;
};

export function requestSummary(row: RequestLogSummaryRow): RequestSummary {
  const routeMethod = row.routeMethod ?? null;
  return {
    id: row._id,
    timestamp: new Date(row.timestamp).toISOString(),
    method: row.method,
    routeMethod,
    uri: row.uri,
    route: row.routeId ? routeRef(routeMethod ?? row.method, row.uri) : null,
    statusCode: row.statusCode,
    responseTimeMs: row.responseTimeMs ?? null,
    errorMessage: truncateMessage(row.errorMessage),
    requestId: row.requestId ?? null,
    source: row.source ?? null,
    consolePath: requestLink(row._id),
  };
}

export const REQUEST_SUMMARY_PROPERTIES = {
  id: { type: "string", description: "Log id" },
  timestamp: DATE_TIME,
  method: { type: "string", description: "Request method" },
  routeMethod: nullable("string", {
    description: "Method of the route that served it, when different",
  }),
  uri: { type: "string", description: "Route pattern, not the raw path" },
  route: nullable("string", {
    description: "METHOD /path of the route; null for a path no route answers",
  }),
  statusCode: { type: "integer" },
  responseTimeMs: nullable("number", {
    description: "Null when not timed",
  }),
  errorMessage: nullable("string", {
    description: `Error message, cut at ${MESSAGE_MAX_LENGTH} characters`,
  }),
  requestId: nullable("string", { description: "x-request-id" }),
  source: nullable("string", { enum: ["tester", "automation", null] }),
  consolePath: {
    type: "string",
    description: "The request in the console's logs",
  },
} satisfies Record<string, JsonSchema>;

export const REQUEST_SUMMARY_SCHEMA = objectSchema(REQUEST_SUMMARY_PROPERTIES);

/** The minute of `at`, seconds zeroed, as an ISO string. */
export function pollMinute(at: Date): string {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString();
}

/** A poll interval in ms: the configured seconds, held within the bounds. */
export function pollIntervalMs(
  seconds: number | undefined,
  bounds: { default: number; min: number; max: number },
): number {
  const value =
    seconds !== undefined && Number.isFinite(seconds)
      ? seconds
      : bounds.default;
  return Math.min(Math.max(value, bounds.min), bounds.max) * 1000;
}

export const POLL_BOUNDS = { default: 60, min: 10, max: 3600 } as const;

/** The poll interval config of the polling triggers. */
export const INTERVAL_CONFIG: JsonSchema = {
  type: "integer",
  title: "Poll interval (seconds)",
  default: POLL_BOUNDS.default,
  minimum: POLL_BOUNDS.min,
  maximum: POLL_BOUNDS.max,
};
