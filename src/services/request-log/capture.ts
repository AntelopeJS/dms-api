import type { IncomingHttpHeaders } from "node:http";
import {
  Context,
  Controller,
  getRegisteredRouteHandlers,
  HandlerPriority,
  Monitor,
  Prefix,
  type RequestContext,
} from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { type DmsApiConfig, getConfig } from "@/config";
import { RequestLogModel, RouteStatisticsModel } from "@/db";
import type {
  RequestLog,
  RequestLogBodyOmission,
  RequestLogSource,
} from "@/db/tables/request_log.table";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { recordLiveRequest } from "@/services/live-feed";
import { requestSource } from "@/services/tester-source";
import { addRequestStatistics } from "@/services/statistics-write";
import type { HttpMethod } from "@/types";
import {
  INTERNAL_PATH_PREFIXES,
  INTERNAL_ROUTE_SUFFIX,
  NS_TO_MS,
  REQUEST_ID_HEADER,
  REQUEST_ID_MAX_LENGTH,
} from "@/types";
import {
  type CapturedBody,
  captureBody,
  extractBody,
  extractContentType,
  extractHeaders,
  extractStatusCode,
  pickHeaders,
  queryToRecord,
} from "./util";

interface CaptureContext extends RequestContext {
  __dmsApiCaptureStart?: bigint;
}

/**
 * Runs ahead of every other prefix, `HIGHEST` included: a prefix that answers
 * (an auth guard's 401) stops the ones after it, which used to leave such
 * requests with no start and a duration of 0 ms. The router sorts prefixes by
 * this number, lowest first.
 */
const CAPTURE_START_PRIORITY = (HandlerPriority.HIGHEST - 1) as HandlerPriority;

/**
 * Per-request capture middleware.
 *
 * The `@Prefix` stamps the start time before any other middleware runs.
 * `@Monitor` LOWEST runs after the full request
 * lifecycle with access to the final response, body, status, headers and
 * any error — crucially, it fires even when a handler throws, which
 * `@Postfix` does not. That's why aggregated `RouteStatistics` writes
 * happen here too: a postfix-based write would miss every 4xx/5xx
 * generated via `assert(...)` / thrown `HTTPResult`, leaving the
 * Monitoring page's error lists permanently empty.
 */
export class RequestLogCapture extends Controller("/") {
  @Prefix("any", "/", CAPTURE_START_PRIORITY)
  start(@Context() context: CaptureContext) {
    context.__dmsApiCaptureStart = process.hrtime.bigint();
  }

  @Monitor("any", "/", HandlerPriority.LOWEST)
  capture(@Context() context: CaptureContext) {
    void persistLog(context).catch((err) => {
      Logging.Error("[dms-api] request log capture failed:", err);
    });
  }
}

/**
 * Null when the request has no start: the router runs prefixes only for a
 * path some handler answers, so an unknown path (404) is never timed. Better
 * no figure than a 0 ms that reads as an instant answer.
 */
function elapsedMs(start?: bigint): number | null {
  return start ? Number(process.hrtime.bigint() - start) / NS_TO_MS : null;
}

/**
 * Traffic the console leaves out entirely, neither logged nor counted: its
 * own endpoints, the DMS's, and the page layouts the DMS frontend loads (see
 * `INTERNAL_PATH_PREFIXES`).
 */
export function isInternalTraffic(rawPath: string, location?: string): boolean {
  return (
    INTERNAL_PATH_PREFIXES.some(
      (prefix) => rawPath === prefix || rawPath.startsWith(`${prefix}/`),
    ) || isPageLayoutPath(location ?? rawPath)
  );
}

/**
 * Whether a route path is the layout the DMS registers for a page
 * (`<page>/pagelayout`, see `INTERNAL_ROUTE_SUFFIX`): plumbing of the
 * console, neither captured nor listed with the API's routes.
 */
export function isPageLayoutPath(path: string): boolean {
  return normalizeRoutePath(path).endsWith(INTERNAL_ROUTE_SUFFIX);
}

/**
 * Calls the DMS console makes by itself, on every page or on a timer: the
 * session check and its refresh, the onboarding and system state, the
 * notification badge. The console's plumbing, not the API's traffic, like
 * `/api/monitoring`. Exact paths, and only on the DMS's own handler: an
 * application route on the same path stays captured.
 */
export const DMS_CONSOLE_PATHS: readonly string[] = [
  "/api/auth/me",
  "/api/auth/refresh",
  "/api/onboarding/informations",
  "/api/system-state",
  "/settings/user/notifications/counts",
];

/**
 * Where the DMS's own console endpoints live: its Settings pages (profile,
 * security, notifications, members, roles…) and the tables they list
 * (members, roles, invites). Left out only on the DMS's own handlers: an
 * application route under the same prefix, a table of its own included,
 * stays captured.
 */
export const DMS_CONSOLE_PATH_PREFIXES: readonly string[] = [
  "/settings",
  "/api/tables",
];

function underDmsConsolePrefix(path: string): boolean {
  return DMS_CONSOLE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Where the DMS console's pages live. A client other than a browser (a
 * script, a link preview) loading one gets it through the DMS frontend,
 * which asks the backend first for anything but an HTML visit, then renders
 * the page itself: no handler answers these requests, and they are the
 * console's, not the API's. `/` is the console's home, exactly.
 */
export const DMS_CONSOLE_PAGE_PREFIXES: readonly string[] = [
  "/auth",
  "/home",
  "/modules",
  "/onboarding",
  "/settings",
];

/** The methods a page is loaded with. */
const PAGE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Whether an unanswered request loads a DMS console page (see
 * `DMS_CONSOLE_PAGE_PREFIXES`). Only ever asked for a request no handler
 * matched: an application route on the same path stays captured.
 */
export function isDmsConsolePage(method: string, rawPath: string): boolean {
  if (!PAGE_METHODS.has(method.toUpperCase())) return false;
  const path = normalizeRoutePath(rawPath);
  return (
    path === "/" ||
    DMS_CONSOLE_PAGE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  );
}

/** Prefix of the DMS's own endpoints: the module behind them is the DMS. */
const DMS_ENDPOINT_PREFIX = "/dms/";

/** A registered handler, as far as telling its module goes. */
export interface HandlerOwner {
  location: string;
  /** Module that registered it, when interface-api could tell. */
  module?: string;
}

/** The module the DMS runs as, read from the handlers of its `/dms/*` endpoints. */
export function dmsModuleOf(
  handlers: readonly HandlerOwner[],
): string | undefined {
  return handlers.find(
    (handler) =>
      handler.module && handler.location.startsWith(DMS_ENDPOINT_PREFIX),
  )?.module;
}

/**
 * Whether a handler answers one of the DMS console's own calls: a path of
 * `DMS_CONSOLE_PATHS`, or any path under `DMS_CONSOLE_PATH_PREFIXES`. Its
 * module must be the DMS's. For an exact path, when the modules cannot be
 * told apart (none recorded), the path decides; under a prefix, which an
 * application may use too, the module must be known to be the DMS's.
 * `handlers` is only read for a path of the list or under a prefix.
 */
export function isDmsConsoleCall(
  handler: HandlerOwner,
  handlers: () => readonly HandlerOwner[] = registeredHandlers,
): boolean {
  const path = normalizeRoutePath(handler.location);
  if (DMS_CONSOLE_PATHS.includes(path)) {
    const dms = dmsModuleOf(handlers());
    return !handler.module || !dms || handler.module === dms;
  }
  if (!underDmsConsolePrefix(path) || !handler.module) return false;
  return handler.module === dmsModuleOf(handlers());
}

/** Every registered handler answering requests, with its module. */
export function registeredHandlers(): HandlerOwner[] {
  return getRegisteredRouteHandlers()
    .filter(({ handler }) => handler.mode === "handler")
    .map(({ handler }) => ({
      location: handler.location,
      module: handler.module,
    }));
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

/** The request's `x-request-id`, when it is short enough to be an id. */
export function requestIdOf(headers: IncomingHttpHeaders): string | undefined {
  const id = headerValue(headers, REQUEST_ID_HEADER);
  return id && id.length <= REQUEST_ID_MAX_LENGTH ? id : undefined;
}

/**
 * Daily rollup write — fire-and-forget so RequestLog persistence isn't gated
 * on it. Only called for matched routes; unmatched URLs (404s for unknown
 * paths) would otherwise pollute the per-route aggregates with one synthetic
 * row per typo.
 */
function recordRouteStatistics(
  method: string,
  uri: string,
  statusCode: number,
  responseTimeMs: number,
): void {
  void addRequestStatistics(GetModel(RouteStatisticsModel), {
    responseTime: responseTimeMs,
    method: method as HttpMethod,
    uri,
    statusCode,
  }).catch((err) => {
    Logging.Error("[dms-api] route statistics write failed:", err);
  });
}

interface BodyCapture {
  headers: Record<string, string>;
  body: CapturedBody;
}

const PAYLOAD_TOO_LARGE = 413;

function omittedBody(omitted: RequestLogBodyOmission): CapturedBody {
  return { truncated: false, omitted, redacted: 0 };
}

/** Whether the request announced a body, read or not. */
function announcesBody(headers: IncomingHttpHeaders): boolean {
  return (
    Number(headers["content-length"]) > 0 ||
    headers["transfer-encoding"] !== undefined
  );
}

async function captureRequest(
  context: CaptureContext,
  config: DmsApiConfig,
  droppedHeaders: string[],
): Promise<BodyCapture> {
  const rawHeaders = context.rawRequest.headers;
  const headers = pickHeaders(
    rawHeaders,
    config.requestLogCaptureHeaders,
    droppedHeaders,
  );
  // interface-api's ReadBody caches a pending Promise<Buffer> on
  // `context.body` (it never swaps in the resolved buffer), so await it —
  // stringifying the promise itself would capture "{}". Stays undefined when
  // no handler consumed the body: reading the request stream after the
  // response is sent isn't safe (it may never emit `end`).
  let raw: unknown;
  try {
    // Typed on the way in rather than suppressed: interface-api caches a
    // pending Promise<Buffer> on `context.body`, which its own `unknown` does
    // not say, and the await is what resolves it.
    raw = await (context.body as Promise<unknown> | undefined);
  } catch (err) {
    // ReadBody refuses a body over its limit with a 413 HTTPResult.
    const tooLarge = extractStatusCode(err) === PAYLOAD_TOO_LARGE;
    return { headers, body: omittedBody(tooLarge ? "too-large" : "not-read") };
  }
  if (raw === undefined && announcesBody(rawHeaders)) {
    const disabled = config.requestLogMaxBodySize <= 0;
    return { headers, body: omittedBody(disabled ? "disabled" : "not-read") };
  }
  return {
    headers,
    body: captureBody(
      raw,
      headerValue(rawHeaders, "content-type"),
      config.requestLogMaxBodySize,
    ),
  };
}

/**
 * The response's headers as it will send them: the ones set on it, plus the
 * content type and length the server adds when writing it.
 */
function sentHeaders(
  response: unknown,
  contentType: string | undefined,
  body: unknown,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(extractHeaders(response))) {
    headers[name.toLowerCase()] = value;
  }
  if (contentType) headers["content-type"] ??= contentType;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    headers["content-length"] ??= String(Buffer.byteLength(body));
  }
  return headers;
}

function captureResponse(
  response: unknown,
  config: DmsApiConfig,
  droppedHeaders: string[],
): BodyCapture {
  const body = extractBody(response);
  const headers = sentHeaders(response, extractContentType(response), body);
  return {
    headers: pickHeaders(
      headers,
      config.requestLogCaptureHeaders,
      droppedHeaders,
    ),
    body: captureBody(
      body,
      headers["content-type"],
      config.requestLogMaxBodySize,
    ),
  };
}

/** The route a request reached, as the log and the statistics key it. */
export interface RequestRoute {
  matched: MatchedRoute | undefined;
  method: string;
  /** Method of the matched route, when it differs from the request's. */
  routeMethod: string | undefined;
  /** Canonical pattern of the matched route, or the raw path. */
  uri: string;
  rawPath: string;
}

interface LogInputs {
  context: CaptureContext;
  route: RequestRoute;
  statusCode: number;
  responseTimeMs: number | null;
  source: RequestLogSource | undefined;
  request: BodyCapture;
  response: BodyCapture;
  query: ReturnType<typeof queryToRecord>;
  droppedHeaders: string[];
}

/**
 * The stored record. Small fields first: a search reads the path and the
 * error message of every row, and the database walks a document's fields in
 * order to reach them, so they come before the headers and bodies.
 */
function assembleLogRecord(input: LogInputs) {
  const { context, route, request, response } = input;
  const headers = context.rawRequest.headers;
  return {
    timestamp: new Date(),
    method: route.method,
    uri: route.uri,
    rawPath: route.rawPath,
    statusCode: input.statusCode,
    responseTimeMs: input.responseTimeMs,
    error:
      formatError(context.error) ??
      responseError(input.statusCode, context.response),
    routeId: route.matched?.id,
    routeMethod: route.routeMethod,
    source: input.source,
    requestId: requestIdOf(headers),
    ip: clientIp(context),
    userAgent: headerValue(headers, "user-agent"),
    pathParams: route.matched?.params ?? {},
    query: input.query.query,
    requestHeaders: request.headers,
    requestBody: request.body.body,
    requestBodyTruncated: request.body.truncated,
    requestBodyOmitted: request.body.omitted,
    requestBodySize: request.body.size,
    responseHeaders: response.headers,
    responseBody: response.body.body,
    responseBodyTruncated: response.body.truncated,
    responseBodyOmitted: response.body.omitted,
    responseBodySize: response.body.size,
    redactions: {
      query: input.query.redacted,
      requestBody: request.body.redacted,
      responseBody: response.body.redacted,
      headers: [...new Set(input.droppedHeaders)],
    },
  };
}

/**
 * Which route a request reached. @Monitor doesn't expose
 * `context.routeParameters`, so the raw path is matched against registered
 * handler patterns to recover the route id and canonical URI. Falls back to
 * the raw path when nothing matches — those entries show up in Logs but are
 * excluded from per-route aggregates. A HEAD with no handler of its own is
 * answered by the GET handler, as the router does it, so it belongs to the
 * GET route.
 */
export function resolveRequestRoute(
  method: string,
  rawPath: string,
): RequestRoute {
  const matched =
    matchRoute(method, rawPath) ??
    (method === "HEAD" ? matchRoute("GET", rawPath) : undefined);
  const handlerMethod = matched?.method.toUpperCase();
  return {
    matched,
    method,
    routeMethod:
      handlerMethod && handlerMethod !== method ? handlerMethod : undefined,
    uri: normalizeRoutePath(matched?.location ?? rawPath),
    rawPath,
  };
}

async function persistLog(context: CaptureContext): Promise<void> {
  const config = getConfig();
  const responseTimeMs = elapsedMs(context.__dmsApiCaptureStart);
  const method = (context.rawRequest.method || "GET").toUpperCase();
  const route = resolveRequestRoute(method, context.url.pathname);
  if (isInternalTraffic(route.rawPath, route.matched?.location)) return;
  if (route.matched && isDmsConsoleCall(route.matched)) return;
  if (!route.matched && isDmsConsolePage(method, route.rawPath)) return;

  const statusCode = extractStatusCode(context.response);
  const source = requestSource(context.rawRequest.headers);

  // A matched request always has a start: the capture prefix runs first on
  // every path a handler answers. The Tester's requests are logged but not
  // counted, or each test would weigh in the health and the incidents.
  if (route.matched && responseTimeMs !== null && !source) {
    recordRouteStatistics(
      route.routeMethod ?? method,
      route.uri,
      statusCode,
      responseTimeMs,
    );
  }

  const droppedHeaders: string[] = [];
  const request = await captureRequest(context, config, droppedHeaders);
  const response = captureResponse(context.response, config, droppedHeaders);
  const log = assembleLogRecord({
    context,
    route,
    statusCode,
    responseTimeMs,
    source,
    request,
    response,
    query: queryToRecord(context.url),
    droppedHeaders,
  });
  await GetModel(RequestLogModel).insert(log as RequestLog);
  // Once stored: a page told about it reads it back.
  recordLiveRequest({
    timestamp: log.timestamp,
    statusCode,
    tester: source === "tester",
  });
}

interface MatchedRoute {
  id: string;
  method: string;
  location: string;
  params: Record<string, string>;
  /** Module that registered the handler, when known. */
  module?: string;
}

/**
 * Match a raw request path against registered handler patterns.
 * Returns the first handler whose pattern accepts the path (segment-by-segment,
 * with `:name` as a wildcard) and the extracted path params. Iterates the
 * full handler list each call — handler counts are in the hundreds at most
 * and this runs once per request, so a precomputed regex table isn't worth
 * the added complexity.
 */
function matchRoute(method: string, rawPath: string): MatchedRoute | undefined {
  const lcMethod = method.toLowerCase();
  const pathSegs = rawPath.split("/").filter(Boolean);
  for (const { id, handler } of getRegisteredRouteHandlers()) {
    if (handler.mode !== "handler") continue;
    if (handler.method !== "any" && handler.method.toLowerCase() !== lcMethod) {
      continue;
    }
    const params = matchSegments(handler.location, pathSegs);
    if (params) {
      return {
        id,
        method: handler.method,
        location: handler.location,
        params,
        module: handler.module,
      };
    }
  }
  return undefined;
}

function matchSegments(
  pattern: string,
  pathSegs: string[],
): Record<string, string> | undefined {
  const patSegs = pattern.split("/").filter(Boolean);
  if (patSegs.length !== pathSegs.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patSegs.length; i++) {
    const p = patSegs[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = pathSegs[i];
    } else if (p !== pathSegs[i]) {
      return undefined;
    }
  }
  return params;
}

const ERROR_STATUS_MIN = 400;
const BODY_MESSAGE_KEYS = ["error", "message"] as const;

/**
 * The message an error response carries: `{ error }` or `{ message }`, the
 * shape `HTTPResult` bodies and `assert` use. Read from the body object, or
 * from its JSON text.
 */
export function bodyErrorMessage(body: unknown): string | undefined {
  let value = body;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  for (const key of BODY_MESSAGE_KEYS) {
    const message = (value as Record<string, unknown>)[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return undefined;
}

function responseError(
  statusCode: number,
  response: unknown,
): { message: string } | undefined {
  if (statusCode < ERROR_STATUS_MIN) return undefined;
  const message = bodyErrorMessage(extractBody(response));
  return message ? { message } : undefined;
}

function formatError(
  err: unknown,
): { message: string; stack?: string } | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  // A thrown HTTPResult: its body says what went wrong, its status otherwise.
  if (typeof (err as { getStatus?: unknown }).getStatus === "function") {
    return {
      message:
        bodyErrorMessage(extractBody(err)) ?? `HTTP ${extractStatusCode(err)}`,
    };
  }
  // `String(err)`, not its JSON form. A thrown HTTPResult is not an Error, so
  // JSON would serialise its whole own-property graph -- body and headers
  // included -- into a column this module otherwise fills through an allowlist,
  // unbounded, and render it to anyone who can open Monitoring. It also throws
  // on a cycle or a BigInt, where this path has to be total, and prints "{}" for
  // an object whose message lives in its `toString`.
  try {
    // oxlint-disable-next-line typescript/no-base-to-string
    return { message: String(err) };
  } catch {
    return { message: "unknown error" };
  }
}

function clientIp(context: CaptureContext): string | undefined {
  const fwd = context.rawRequest.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0];
  }
  return context.rawRequest.socket.remoteAddress ?? undefined;
}
