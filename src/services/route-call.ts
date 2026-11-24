import { performance } from "node:perf_hooks";
import { z } from "zod";
import { type DmsApiConfig, getConfig } from "@/config";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { REQUEST_ID_HEADER, REQUEST_ID_MAX_LENGTH } from "@/types";
import type { JsonBody } from "@/types/json";
import { apiOrigin } from "./api-origin";
import { logsLink, routeRef } from "./links";
import { getRegisteredRouteHandlers } from "@antelopejs/interface-api";
import { isRefusedHandler, reachesRefusedRoute } from "./route-call-reach";
import { findRouteHandler, parseRouteRef } from "./route-catalog";
import { issueSourceToken } from "./tester-source";

/** What `api.call-route` asks for. */
export interface RouteCallInput {
  route: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: JsonBody;
  credential?: string | null;
  timeoutMs?: number;
  includeBody?: boolean;
}

/** A call checked and ready to send. */
export interface PreparedRouteCall {
  method: string;
  route: string;
  url: string;
  headers: Headers;
  body: string | undefined;
  timeoutMs: number;
  requestId: string;
  logsPath: string;
}

/** What a call answered. */
export interface RouteCallResult {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  contentType: string | null;
  body: unknown;
  bodyTruncated: boolean;
}

export const ROUTE_CALL_LIMITS = {
  bodyBytes: 65_536,
  responseChars: 16_384,
  errorChars: 300,
  defaultTimeoutMs: 10_000,
} as const;

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const DOT_SEGMENTS = new Set([".", ".."]);
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function fail(message: string): never {
  throw new Error(message);
}

function registeredOwners() {
  return getRegisteredRouteHandlers()
    .filter(({ handler }) => handler.mode === "handler")
    .map(({ handler }) => ({
      location: handler.location,
      module: handler.module,
    }));
}

const SIMPLE_PARAMETER = /^:[A-Za-z0-9_$-]+$/;

function refuseInternal(method: string, path: string): never {
  fail(
    `${method} ${path} reaches an internal route of the console, the DMS or the automation module: a procedure cannot call it`,
  );
}

/**
 * The registered handler a ref names, when a procedure may call it: not the
 * console's endpoints, not the DMS's own console, account or onboarding
 * endpoints, not a page layout, not the automation API. Anything else fails
 * the step. The filled path is checked again by {@link prepareRouteCall}.
 */
export function callableRoute(ref: string) {
  const parsed = parseRouteRef(ref);
  if (!parsed) fail(`"${ref}" is not a METHOD /path route`);
  const found = findRouteHandler(ref);
  if (!found)
    fail(`No registered route answers ${parsed.method} ${parsed.path}`);
  const { handler } = found;
  const path = normalizeRoutePath(handler.location);
  if (
    isRefusedHandler(
      { location: handler.location, module: handler.module },
      registeredOwners,
    )
  ) {
    refuseInternal(parsed.method, path);
  }
  return { method: parsed.method, path, ref: routeRef(parsed.method, path) };
}

/**
 * `path` with each `:name` segment replaced by its encoded value. A route
 * with a composite (`file.:ext`) or catch-all (`::rest`) segment cannot be
 * filled and fails the step.
 */
export function fillPath(
  path: string,
  params: Record<string, string> = {},
): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment.includes(":")) return segment;
      if (!SIMPLE_PARAMETER.test(segment)) {
        fail(
          `The segment "${segment}" of ${path} cannot be filled: only whole :name segments can`,
        );
      }
      const name = segment.slice(1);
      const value = Object.hasOwn(params, name) ? params[name] : undefined;
      if (value === undefined || value === "") {
        fail(`pathParams.${name} is required by the route`);
      }
      if (DOT_SEGMENTS.has(value)) {
        fail(`pathParams.${name} cannot be "${value}"`);
      }
      return encodeURIComponent(value);
    })
    .join("/");
}

function queryString(query: RouteCallInput["query"] = {}): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      search.append(name, each);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function credentialHeaders(name: string | null | undefined) {
  const headers = new Headers();
  if (!name) return headers;
  const profiles = getConfig().automationCredentials ?? {};
  const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined;
  if (!profile) {
    fail(
      `No credential profile "${name}" in the dms-api automationCredentials configuration`,
    );
  }
  for (const [header, value] of Object.entries(profile.headers)) {
    headers.set(header, value);
  }
  return headers;
}

/** Where the DMS says clients reach the API, null when unset. */
export type OriginReader = () => Promise<string | null>;

async function baseUrl(origin: OriginReader): Promise<string> {
  const configured = getConfig().automationCallBaseUrl?.trim();
  const base = configured || (await origin());
  if (!base) {
    fail(
      "No API origin to call: set automationCallBaseUrl in the dms-api configuration, or the DMS apiBaseUrl",
    );
  }
  return base.replace(/\/+$/, "");
}

function serializedBody(method: string, body: JsonBody): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (BODYLESS_METHODS.has(method)) fail(`A ${method} call takes no body`);
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > ROUTE_CALL_LIMITS.bodyBytes) {
    fail(`The body is over ${ROUTE_CALL_LIMITS.bodyBytes} bytes`);
  }
  return text;
}

/** The request id a step's calls are sent with, to find them in the logs. */
export function callRequestId(runId: string, nodeId: string): string {
  return `auto-${runId}-${nodeId}`.slice(0, REQUEST_ID_MAX_LENGTH);
}

/**
 * Checks everything a call needs (the route, its path parameters, the body,
 * the credential profile, the origin) and builds it. The call is marked as
 * the automation's with a token this server signs, so the capture keeps it
 * out of the statistics and the health.
 */
export async function prepareRouteCall(
  input: RouteCallInput,
  requestId: string,
  origin: OriginReader = apiOrigin,
): Promise<PreparedRouteCall> {
  const route = callableRoute(input.route);
  const path = fillPath(route.path, input.pathParams);
  if (reachesRefusedRoute(path)) refuseInternal(route.method, path);
  const body = serializedBody(route.method, input.body);
  const headers = credentialHeaders(input.credential);
  const url = `${await baseUrl(origin)}${path}${queryString(input.query)}`;
  const token = issueSourceToken("automation");
  if (body !== undefined) headers.set("content-type", "application/json");
  headers.set(token.header, token.value);
  headers.set(REQUEST_ID_HEADER, requestId);
  return {
    method: route.method,
    route: route.ref,
    url,
    headers,
    body,
    timeoutMs: input.timeoutMs ?? ROUTE_CALL_LIMITS.defaultTimeoutMs,
    requestId,
    logsPath: logsLink({ requestId }),
  };
}

function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function isJson(contentType: string | null): boolean {
  return contentType !== null && /[/+]json\b/i.test(contentType);
}

/**
 * The response body as text, read until `limit` characters and no further:
 * the rest of the stream is cancelled.
 */
export async function readCapped(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      text += decoder.decode();
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > limit) {
      await reader.cancel();
      return { text: text.slice(0, limit), truncated: true };
    }
  }
  return text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false };
}

async function responseBody(
  response: Response,
  contentType: string | null,
  include: boolean,
): Promise<Pick<RouteCallResult, "body" | "bodyTruncated">> {
  if (!include) {
    await response.body?.cancel();
    return { body: null, bodyTruncated: false };
  }
  const { text, truncated } = await readCapped(
    response,
    ROUTE_CALL_LIMITS.responseChars,
  );
  if (truncated) return { body: text, bodyTruncated: true };
  if (isJson(contentType) && text) {
    try {
      return { body: JSON.parse(text), bodyTruncated: false };
    } catch {
      return { body: text, bodyTruncated: false };
    }
  }
  return { body: text || null, bodyTruncated: false };
}

function callError(error: Error, timeoutMs: number): string {
  if (error.name === "TimeoutError") return `Timed out after ${timeoutMs} ms`;
  return cut(error.message, ROUTE_CALL_LIMITS.errorChars);
}

/** Sends a prepared call: a timeout or a network error is an answer, not a throw. */
export async function sendRouteCall(
  call: PreparedRouteCall,
  includeBody: boolean,
  send: typeof fetch = fetch,
): Promise<RouteCallResult> {
  const started = performance.now();
  try {
    const response = await send(call.url, {
      method: call.method,
      headers: call.headers,
      body: call.body,
      redirect: "manual",
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    const contentType = response.headers.get("content-type");
    const body = await responseBody(response, contentType, includeBody);
    return {
      ok: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      durationMs: Math.round(performance.now() - started),
      error: null,
      contentType,
      ...body,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      durationMs: Math.round(performance.now() - started),
      error: callError(
        error instanceof Error ? error : new Error(String(error)),
        call.timeoutMs,
      ),
      contentType: null,
      body: null,
      bodyTruncated: false,
    };
  }
}

const credentialProfiles = z.record(
  z.string().min(1).max(100),
  z.object({
    headers: z.record(z.string().regex(HEADER_NAME), z.string()),
  }),
);

const baseUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:/i.test(url), "an http or https URL");

const automationConfigSchema = z.object({
  automationCallBaseUrl: baseUrlSchema.optional(),
  automationCredentials: credentialProfiles.optional(),
});

/**
 * What the module configuration sets for `api.call-route` that it cannot
 * use, as `field: reason` lines: the module does not start with it.
 */
export function automationConfigErrors(
  config: Pick<DmsApiConfig, "automationCredentials" | "automationCallBaseUrl">,
): string[] {
  const result = automationConfigSchema.safeParse({
    automationCallBaseUrl: config.automationCallBaseUrl,
    automationCredentials: config.automationCredentials,
  });
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
}
