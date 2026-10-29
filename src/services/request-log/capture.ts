import type { IncomingHttpHeaders } from "node:http";
import {
  Context,
  Controller,
  getRegisteredRouteHandlers,
  HandlerPriority,
  type HTTPResult,
  Monitor,
  Prefix,
  type RequestContext,
} from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { type DmsApiConfig, getConfig } from "@/config";
import { RequestLogModel, RouteStatisticsModel } from "@/db";
import type { RequestLogSource } from "@/db/tables/request_log.table";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { recordLiveRequest } from "@/services/live-feed";
import { requestSource } from "@/services/tester-source";
import { addRequestStatistics } from "@/services/statistics-write";
import { NS_TO_MS, REQUEST_ID_HEADER, REQUEST_ID_MAX_LENGTH } from "@/types";
import { hasStatusGetter, isMessageBody, isString } from "@/guards";
import {
  type CapturedBody,
  captureBody,
  extractBody,
  extractContentType,
  extractHeaders,
  extractStatusCode,
  omittedBody,
  pickHeaders,
  queryToRecord,
} from "./util";
import {
  isDmsConsoleCall,
  isDmsConsolePage,
  isInternalTraffic,
} from "./console-traffic";

export {
  DMS_CONSOLE_PAGE_PREFIXES,
  DMS_CONSOLE_PATH_PREFIXES,
  DMS_CONSOLE_PATHS,
  dmsModuleOf,
  type HandlerOwner,
  isDmsConsoleCall,
  isDmsConsolePage,
  isInternalTraffic,
  isPageLayoutPath,
} from "./console-traffic";

interface CaptureContext extends RequestContext {
  __dmsApiCaptureStart?: bigint;
}

/**
 * Runs ahead of every other prefix, `HIGHEST` included: a prefix that answers
 * (an auth guard's 401) stops the ones after it, which used to leave such
 * requests with no start and a duration of 0 ms. The router sorts prefixes by
 * this number, lowest first.
 */
const CAPTURE_START_PRIORITY: HandlerPriority = HandlerPriority.HIGHEST - 1;

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
    method,
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

/** Whether the request announced a body, read or not. */
function announcesBody(headers: IncomingHttpHeaders): boolean {
  return (
    Number(headers["content-length"]) > 0 ||
    headers["transfer-encoding"] !== undefined
  );
}

/**
 * The request's kept headers and body. interface-api's ReadBody caches a
 * pending Promise<Buffer> on `context.body`, typed `unknown`, never the
 * buffer: it is awaited, as the promise would stringify to "{}". ReadBody
 * refuses a body over its limit with a 413. Unread by every handler, the body
 * stays undefined: the stream may never emit `end` after the response.
 */
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
  let raw: unknown;
  try {
    raw = await context.body;
  } catch (err) {
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
  response: HTTPResult,
  contentType: string | undefined,
  body: unknown,
) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(extractHeaders(response))) {
    headers[name.toLowerCase()] = value;
  }
  if (contentType) headers["content-type"] ??= contentType;
  if (isString(body) || Buffer.isBuffer(body)) {
    headers["content-length"] ??= String(Buffer.byteLength(body));
  }
  return headers;
}

function captureResponse(
  response: HTTPResult,
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

/**
 * Logs a request the API answered. A matched request always has a start: the
 * capture prefix runs first on every path a handler answers. The Tester's
 * requests are logged, not counted, or each test would weigh in the health
 * and the incidents. Live pages hear of it once stored, to read it back.
 */
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
  await GetModel(RequestLogModel).insert(log);
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
  if (isString(value)) {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!isMessageBody(value)) return undefined;
  for (const key of BODY_MESSAGE_KEYS) {
    const message = value[key];
    if (isString(message) && message.trim()) return message.trim();
  }
  return undefined;
}

function responseError(
  statusCode: number,
  response: HTTPResult,
): { message: string } | undefined {
  if (statusCode < ERROR_STATUS_MIN) return undefined;
  const message = bodyErrorMessage(extractBody(response));
  return message ? { message } : undefined;
}

/**
 * What a thrown value says went wrong: an Error's message and stack; a thrown
 * HTTPResult's body message, its status otherwise; anything else as
 * `String(err)`, not its JSON form. A thrown HTTPResult is not an Error, so
 * JSON would serialise its whole own-property graph -- body and headers
 * included -- into a column this module otherwise fills through an allowlist,
 * unbounded, and render it to anyone who can open Monitoring. It also throws
 * on a cycle or a BigInt, where this path has to be total, and prints "{}" for
 * an object whose message lives in its `toString`.
 */
function formatError(
  err: unknown,
): { message: string; stack?: string } | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  if (hasStatusGetter(err)) {
    return {
      message:
        bodyErrorMessage(extractBody(err)) ?? `HTTP ${extractStatusCode(err)}`,
    };
  }
  try {
    // oxlint-disable-next-line typescript/no-base-to-string -- the string form, not the JSON one (see the TSDoc above)
    return { message: String(err) };
  } catch {
    return { message: "unknown error" };
  }
}

function clientIp(context: CaptureContext): string | undefined {
  const fwd = context.rawRequest.headers["x-forwarded-for"];
  if (isString(fwd)) {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0];
  }
  return context.rawRequest.socket.remoteAddress ?? undefined;
}
