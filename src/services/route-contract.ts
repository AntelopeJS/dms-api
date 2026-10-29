/**
 * What a route's traffic says about its contract, for the Documentation tab:
 * statuses with their volume and messages, bodies, parameters with examples,
 * the response a successful call gets.
 *
 * @packageDocumentation
 */
import type { RequestLogModel } from "@/db";
import type { RequestLogSample } from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { MS_PER_DAY } from "@/types";
import type { RouteInspection } from "./introspection";
import { exactQuantile } from "./statistics-utils";

/** A field seen in the logged bodies of a route. */
export interface InferredField {
  name: string;
  types: string[];
  /** Present in every sampled body. */
  required: boolean;
  /** Its value in the most recent body that had it, when it is a scalar. */
  example?: string | number | boolean | null;
}

/** A status the route answered over the window, with what it said. */
export interface ObservedStatus {
  status: number;
  count: number;
  /** The most frequent error message, null when none was recorded. */
  message: string | null;
  /** The most frequent distinct error messages, most frequent first. */
  messages: Array<{ message: string; count: number }>;
  /** Distinct error messages in all, `messages` included. */
  messageCount: number;
  lastSeen: string;
}

/** A response the route sent, as captured. */
export interface ObservedResponse {
  status: number;
  /** The body, cut to {@link RESPONSE_EXAMPLE_CHARS}. */
  body: string;
  json: boolean;
  /** Cut at capture, or here. */
  truncated: boolean;
}

/** What the logged requests of a route say about its contract. */
export interface ObservedContract {
  /** The days the contract is read over, up to now. */
  windowDays: number;
  /** Requests the route answered over the window, the tester's left out. */
  total: number;
  /** The most recent successful JSON body, the tester's starting point. */
  exampleBody: unknown;
  bodyFields: InferredField[];
  /** Successful requests the bodies, examples and response were read from. */
  sampled: number;
  /** Query parameter names seen in the recent requests. */
  queryParams: string[];
  /** Status codes the route answered over the window, with their count. */
  statuses: ObservedStatus[];
  /** Path and query of the most recent successful call: a call that works. */
  examplePath: Record<string, string>;
  exampleQuery: Record<string, string | string[]>;
  /** The most recent successful response. */
  exampleResponse: ObservedResponse | null;
  /** Shape of the successful JSON responses: an object, or a list of them. */
  responseKind: "object" | "array" | null;
  responseFields: InferredField[];
  /** Response time of the successful calls, null without any. */
  latency: { p50: number; p95: number } | null;
}

/** The days of traffic the documentation reads. */
export const CONTRACT_WINDOW_DAYS = 7;
/** Most recent requests read for bodies, examples and query names. */
const CONTRACT_SAMPLE = 200;
/** Longest example response body sent to the page. */
export const RESPONSE_EXAMPLE_CHARS = 16_384;
const STATUS_MESSAGES = 10;

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

/** The fields of `bodies`, most recent first, with their types and an example. */
export function inferBodyFields(
  bodies: Record<string, unknown>[],
): InferredField[] {
  const fields = new Map<
    string,
    { types: Set<string>; seen: number; example: unknown }
  >();
  for (const body of bodies) {
    for (const [name, value] of Object.entries(body)) {
      const field = fields.get(name) ?? {
        types: new Set<string>(),
        seen: 0,
        example: value,
      };
      field.types.add(typeName(value));
      field.seen += 1;
      fields.set(name, field);
    }
  }
  return [...fields].map(([name, field]) => {
    const inferred: InferredField = {
      name,
      types: [...field.types].sort(),
      required: field.seen === bodies.length,
    };
    if (isScalar(field.example)) inferred.example = field.example;
    return inferred;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Traffic the Tester sent: the console's own calls, kept in the logs but not
 * read as what clients do (contract: the log carries `source: "tester"`).
 */
function fromTester(entry: RequestLog | RequestLogSample): boolean {
  return "source" in entry && entry.source === "tester";
}

/** The statuses of a window of samples, each with all its messages. */
export function observedStatuses(
  samples: Array<
    Pick<RequestLogSample, "statusCode" | "timestamp" | "errorMessage">
  >,
): ObservedStatus[] {
  const statuses = new Map<
    number,
    { count: number; messages: Map<string, number>; lastSeen: Date }
  >();
  for (const sample of samples) {
    const entry = statuses.get(sample.statusCode) ?? {
      count: 0,
      messages: new Map<string, number>(),
      lastSeen: sample.timestamp,
    };
    entry.count += 1;
    if (sample.timestamp > entry.lastSeen) entry.lastSeen = sample.timestamp;
    if (sample.errorMessage) {
      entry.messages.set(
        sample.errorMessage,
        (entry.messages.get(sample.errorMessage) ?? 0) + 1,
      );
    }
    statuses.set(sample.statusCode, entry);
  }
  return [...statuses]
    .map(([status, entry]) => {
      const messages = [...entry.messages]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, STATUS_MESSAGES);
      return {
        status,
        count: entry.count,
        message: messages[0]?.message ?? null,
        messages,
        messageCount: entry.messages.size,
        lastSeen: new Date(entry.lastSeen).toISOString(),
      };
    })
    .sort((a, b) => a.status - b.status);
}

function exampleResponse(log: RequestLog | undefined): ObservedResponse | null {
  if (!log?.responseBody) return null;
  const json = parseJson(log.responseBody);
  const text =
    json === undefined ? log.responseBody : JSON.stringify(json, null, 2);
  return {
    status: log.statusCode,
    body: text.slice(0, RESPONSE_EXAMPLE_CHARS),
    json: json !== undefined,
    truncated:
      log.responseBodyTruncated || text.length > RESPONSE_EXAMPLE_CHARS,
  };
}

function responseFieldsOf(
  logs: RequestLog[],
): Pick<ObservedContract, "responseKind" | "responseFields"> {
  const bodies = logs.map((log) => parseJson(log.responseBody));
  const lists = bodies.filter(Array.isArray);
  const objects = bodies.filter(isRecord);
  if (lists.length > objects.length) {
    return {
      responseKind: "array",
      responseFields: inferBodyFields(
        lists.flatMap((list) => list.filter(isRecord)),
      ),
    };
  }
  if (objects.length > 0) {
    return { responseKind: "object", responseFields: inferBodyFields(objects) };
  }
  return { responseKind: null, responseFields: [] };
}

function latencyOf(
  samples: Array<Pick<RequestLogSample, "statusCode" | "responseTimeMs">>,
): ObservedContract["latency"] {
  const durations = samples
    .filter((sample) => sample.statusCode < 400)
    .map((sample) => sample.responseTimeMs)
    .filter((ms): ms is number => typeof ms === "number");
  const p50 = exactQuantile(durations, 0.5);
  const p95 = exactQuantile(durations, 0.95);
  return p50 === null || p95 === null ? null : { p50, p95 };
}

function newestFirst(a: RequestLog, b: RequestLog): number {
  return +new Date(b.timestamp) - +new Date(a.timestamp);
}

/** The traffic of a route a contract is read from, the tester's left out. */
export interface ContractTraffic {
  /** Every request of the window, reduced to status, time and message. */
  samples: RequestLogSample[];
  /** The most recent successful requests, newest first. */
  successful: RequestLog[];
  /** The most recent requests, whatever their status, newest first. */
  latest: RequestLog[];
}

/**
 * The traffic of a route over the last {@link CONTRACT_WINDOW_DAYS} days.
 * The tester's calls are left out, so trying a route does not rewrite its
 * documentation.
 */
export async function loadContractTraffic(
  model: RequestLogModel,
  method: string,
  path: string,
  now: Date = new Date(),
): Promise<ContractTraffic> {
  const since = new Date(now.getTime() - CONTRACT_WINDOW_DAYS * MS_PER_DAY);
  const filters = {
    method,
    since,
    until: now,
    uri: normalizeRoutePath(path),
    apiTrafficOnly: true,
  };
  const recent = (statusClass?: "success") =>
    model
      .query({ ...filters, statusClass, limit: CONTRACT_SAMPLE })
      .then(({ results }) =>
        results.filter((log) => !fromTester(log)).sort(newestFirst),
      );
  const [samples, successful, latest] = await Promise.all([
    model
      .samples(filters)
      .then((rows) => rows.filter((row) => !fromTester(row))),
    recent("success"),
    recent(),
  ]);
  return { samples, successful, latest };
}

/**
 * The contract a route's traffic shows: every status with its real volume
 * and messages over the window, the bodies, examples and response shape from
 * the most recent successful calls.
 */
export function contractOf({
  samples,
  successful,
  latest,
}: ContractTraffic): ObservedContract {
  const bodies = successful
    .map((log) => parseJson(log.requestBody))
    .filter(isRecord);
  const queryParams = new Set<string>();
  for (const log of [...successful, ...latest]) {
    for (const key of Object.keys(log.query ?? {})) queryParams.add(key);
  }
  const last = successful[0];
  return {
    windowDays: CONTRACT_WINDOW_DAYS,
    total: samples.length,
    exampleBody: bodies[0] ?? null,
    bodyFields: inferBodyFields(bodies),
    sampled: successful.length,
    queryParams: [...queryParams].sort(),
    statuses: observedStatuses(samples),
    examplePath: last?.pathParams ?? {},
    exampleQuery: last?.query ?? {},
    exampleResponse: exampleResponse(last),
    ...responseFieldsOf(successful),
    latency: latencyOf(samples),
  };
}

/** A parameter of a route, documented with a type and an example. */
export interface DocumentedParameter {
  name: string;
  in: "path" | "query" | "header";
  /** Declared by the handler, else inferred from the example. */
  type: string;
  /** Its value in the most recent successful call that had it. */
  example: string | null;
  /** Read by the handler (@Parameter), not only seen in the traffic. */
  declared: boolean;
  required: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** The type a parameter's value reads as. */
export function valueType(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  if (UUID.test(value)) return "uuid";
  if (ISO_DATE.test(value)) return "date";
  return "string";
}

function firstValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Path, query and header parameters: those the handler declares, those the
 * path names and those the traffic shows, each with the value of the most
 * recent successful call that had it.
 */
export function documentParameters(
  inspection: RouteInspection,
  successful: Array<
    Pick<RequestLog, "pathParams" | "query" | "requestHeaders">
  >,
  queryParams: string[],
): DocumentedParameter[] {
  const example = (where: DocumentedParameter["in"], name: string) => {
    for (const log of successful) {
      const value =
        where === "path"
          ? log.pathParams?.[name]
          : where === "query"
            ? firstValue(log.query?.[name])
            : log.requestHeaders?.[name.toLowerCase()];
      if (value) return value;
    }
    return null;
  };
  const declared = new Map(
    inspection.parameters
      .filter(
        (parameter) =>
          parameter.name &&
          (parameter.source === "param" ||
            parameter.source === "query" ||
            parameter.source === "header"),
      )
      .map((parameter) => [`${parameter.source}:${parameter.name}`, parameter]),
  );
  const entries: Array<{ in: DocumentedParameter["in"]; name: string }> = [
    ...inspection.location
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => ({ in: "path" as const, name: segment.slice(1) })),
    ...[
      ...new Set([
        ...inspection.parameters.flatMap((parameter) =>
          parameter.source === "query" && parameter.name
            ? [parameter.name]
            : [],
        ),
        ...queryParams,
      ]),
    ]
      .sort()
      .map((name) => ({ in: "query" as const, name })),
    ...inspection.parameters.flatMap((parameter) =>
      parameter.source === "header" && parameter.name
        ? [{ in: "header" as const, name: parameter.name }]
        : [],
    ),
  ];
  return entries.map((entry) => {
    const source = entry.in === "path" ? "param" : entry.in;
    const parameter = declared.get(`${source}:${entry.name}`);
    const value = example(entry.in, entry.name);
    let type = value ? valueType(value) : "string";
    if (parameter?.multi) type = `${type}[]`;
    else if (
      parameter &&
      parameter.inferredType !== "string" &&
      parameter.inferredType !== "unknown"
    )
      type = parameter.inferredType;
    return {
      name: entry.name,
      in: entry.in,
      type,
      example: value,
      declared: parameter !== undefined,
      required: entry.in === "path",
    };
  });
}
