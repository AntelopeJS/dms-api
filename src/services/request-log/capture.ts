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
import { addRequestStatistics } from "@/services/statistics-write";
import type { HttpMethod } from "@/types";
import { NS_TO_MS } from "@/types";
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
 * Per-request capture middleware.
 *
 * `@Prefix` HIGHEST stamps the start time before any other middleware can
 * mutate the context. `@Monitor` LOWEST runs after the full request
 * lifecycle with access to the final response, body, status, headers and
 * any error — crucially, it fires even when a handler throws, which
 * `@Postfix` does not. That's why aggregated `RouteStatistics` writes
 * happen here too: a postfix-based write would miss every 4xx/5xx
 * generated via `assert(...)` / thrown `HTTPResult`, leaving the
 * Monitoring page's error lists permanently empty.
 */
export class RequestLogCapture extends Controller("/") {
  @Prefix("any", "/", HandlerPriority.HIGHEST)
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

function elapsedMs(start?: bigint): number {
  return start ? Number(process.hrtime.bigint() - start) / NS_TO_MS : 0;
}

/**
 * Daily rollup write — fire-and-forget so RequestLog persistence isn't gated
 * on it. Only called for matched routes; unmatched URLs (404s for unknown
 * paths) would otherwise pollute the per-route aggregates with one synthetic
 * row per typo.
 */
function recordRouteStatistics(
  method: HttpMethod,
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

async function captureRequest(
  context: CaptureContext,
  config: DmsApiConfig,
): Promise<BodyCapture> {
  const headers = pickHeaders(
    context.rawRequest.headers,
    config.requestLogCaptureHeaders,
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
  } catch {
    raw = undefined;
  }
  return {
    headers,
    body: captureBody(
      raw,
      headers["content-type"],
      config.requestLogMaxBodySize,
    ),
  };
}

function captureResponse(response: unknown, config: DmsApiConfig): BodyCapture {
  const rawHeaders = extractHeaders(response);
  const contentType =
    extractContentType(response) ?? rawHeaders["content-type"];
  return {
    headers: pickHeaders(rawHeaders, config.requestLogCaptureHeaders),
    body: captureBody(
      extractBody(response),
      contentType,
      config.requestLogMaxBodySize,
    ),
  };
}

interface LogInputs {
  context: CaptureContext;
  matched: MatchedRoute | undefined;
  method: HttpMethod;
  uri: string;
  rawPath: string;
  statusCode: number;
  responseTimeMs: number;
  request: BodyCapture;
  response: BodyCapture;
}

function assembleLogRecord(input: LogInputs) {
  const { context, matched, request, response } = input;
  const log = {
    timestamp: new Date(),
    method: input.method,
    uri: input.uri,
    rawPath: input.rawPath,
    routeId: matched?.id,
    pathParams: matched?.params ?? {},
    query: queryToRecord(context.url),
    requestHeaders: request.headers,
    requestBody: request.body.body,
    requestBodyTruncated: request.body.truncated,
    statusCode: input.statusCode,
    responseTimeMs: input.responseTimeMs,
    responseHeaders: response.headers,
    responseBody: response.body.body,
    responseBodyTruncated: response.body.truncated,
    error: formatError(context.error),
    ip: clientIp(context),
    userAgent: (
      context.rawRequest.headers["user-agent"] as string | undefined
    )?.toString(),
  };
  return log;
}

async function persistLog(context: CaptureContext): Promise<void> {
  const config = getConfig();
  const responseTimeMs = elapsedMs(context.__dmsApiCaptureStart);
  const method = (
    context.rawRequest.method || "GET"
  ).toUpperCase() as HttpMethod;
  const rawPath = context.url.pathname;

  // @Monitor doesn't expose `context.routeParameters`, so match the raw path
  // against registered handler patterns to recover the route id and canonical
  // URI. Falls back to the raw path when nothing matches — those entries show
  // up in Logs but are excluded from per-route aggregates.
  const matched = matchRoute(method, rawPath);
  const uri = matched?.location ?? rawPath;
  const statusCode = extractStatusCode(context.response);

  if (matched?.id) {
    recordRouteStatistics(method, uri, statusCode, responseTimeMs);
  }

  const request = await captureRequest(context, config);
  const response = captureResponse(context.response, config);
  const log = assembleLogRecord({
    context,
    matched,
    method,
    uri,
    rawPath,
    statusCode,
    responseTimeMs,
    request,
    response,
  });
  await GetModel(RequestLogModel).insert(log);
}

interface MatchedRoute {
  id: string;
  location: string;
  params: Record<string, string>;
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
      return { id, location: handler.location, params };
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

function formatError(
  err: unknown,
): { message: string; stack?: string } | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
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
