import {
  getRegisteredRouteHandlers,
  type RegisteredRouteHandler,
} from "@antelopejs/interface-api";
import { getConfig } from "@/config";
import type { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import type { RequestLog } from "@/db/tables/request_log.table";
import { MS_PER_DAY } from "@/types";
import {
  getRouteInspection,
  type MiddlewareInfo,
  type RouteInspection,
} from "./introspection";
import { routeRef } from "./links";
import { computeRouteHealth, issueOf, type RouteIssue } from "./route-health";
import { scopeRouteKey } from "./scope";
import {
  loadSamples,
  loadTraffic,
  type ScopeKeys,
  sumBuckets,
  type TrafficBucket,
} from "./traffic";

export interface CatalogModels {
  logs: RequestLogModel;
  stats: RouteStatisticsModel;
  routes: RouteModel;
}

/** A route's state in the tree: its issue, or idle without traffic. */
export type RouteState = RouteIssue | "healthy" | "idle";

/** One route of the Routes tree. */
export interface RouteRow {
  ref: string;
  method: string;
  path: string;
  /** Leading static segments the tree groups routes under. */
  folder: string;
  controller: string | null;
  handler: string;
  requests: number;
  state: RouteState;
}

const FOLDER_DEPTH = 2;

/** `/api/orders/:id/refund` → `/api/orders`; `/health` → `/health`. */
export function folderOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const statics: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(":") || statics.length === FOLDER_DEPTH) break;
    statics.push(segment);
  }
  return `/${statics.join("/")}`;
}

function routeHandlers(keys: ScopeKeys): RegisteredRouteHandler[] {
  return getRegisteredRouteHandlers().filter(
    ({ handler }) =>
      handler.mode === "handler" &&
      (!keys || keys.has(scopeRouteKey(handler.method, handler.location))),
  );
}

function stateOf(traffic: TrafficBucket | undefined): RouteState {
  if (!traffic || traffic.requests === 0) return "idle";
  return issueOf(traffic, getConfig().requestSlownessThreshold) ?? "healthy";
}

/** Every route in scope, with its traffic and state over the last 24 h. */
export async function listRoutes(
  models: CatalogModels,
  keys: ScopeKeys,
  now: Date = new Date(),
): Promise<RouteRow[]> {
  const range = { from: new Date(now.getTime() - MS_PER_DAY), to: now };
  const health = computeRouteHealth(
    await loadSamples(models.logs, range, keys),
  );
  return routeHandlers(keys)
    .map(({ handler }) => {
      const method = handler.method.toUpperCase();
      const traffic = health.get(
        scopeRouteKey(method, handler.location),
      )?.traffic;
      return {
        ref: routeRef(method, handler.location),
        method,
        path: handler.location,
        folder: folderOf(handler.location),
        controller:
          (handler.proto as { constructor?: { name?: string } } | undefined)
            ?.constructor?.name ?? null,
        handler: handler.callback.name || "anonymous",
        requests: traffic?.requests ?? 0,
        state: stateOf(traffic),
      };
    })
    .sort(
      (a, b) =>
        a.folder.localeCompare(b.folder) ||
        a.path.localeCompare(b.path) ||
        a.method.localeCompare(b.method),
    );
}

/** Split `METHOD /path` into its parts; undefined for anything else. */
export function parseRouteRef(
  ref: string | undefined,
): { method: string; path: string } | undefined {
  const match = ref?.trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
  if (!match) return undefined;
  return { method: match[1].toUpperCase(), path: match[2] };
}

/** The registered handler a `METHOD /path` reference names. */
export function findRoute(
  ref: string | undefined,
): RouteInspection | undefined {
  const parsed = parseRouteRef(ref);
  if (!parsed) return undefined;
  const found = getRegisteredRouteHandlers().find(
    ({ handler }) =>
      handler.mode === "handler" &&
      handler.method.toUpperCase() === parsed.method &&
      handler.location === parsed.path,
  );
  return found ? getRouteInspection(found.id) : undefined;
}

/** A body field seen in the logged requests of a route. */
export interface InferredField {
  name: string;
  types: string[];
  /** Present in every sampled body. */
  required: boolean;
}

/** What the logged requests of a route say about its contract. */
export interface ObservedContract {
  /** The most recent successful JSON body, the tester's starting point. */
  exampleBody: unknown;
  bodyFields: InferredField[];
  queryParams: string[];
  /** Status codes the route answered, with their count. */
  statuses: Array<{ status: number; count: number; message: string | null }>;
  sampled: number;
}

const CONTRACT_SAMPLE = 50;

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

function inferBodyFields(bodies: Record<string, unknown>[]): InferredField[] {
  const fields = new Map<string, { types: Set<string>; seen: number }>();
  for (const body of bodies) {
    for (const [name, value] of Object.entries(body)) {
      const field = fields.get(name) ?? { types: new Set<string>(), seen: 0 };
      field.types.add(typeName(value));
      field.seen += 1;
      fields.set(name, field);
    }
  }
  return [...fields].map(([name, field]) => ({
    name,
    types: [...field.types].sort(),
    required: field.seen === bodies.length,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observedStatuses(logs: RequestLog[]): ObservedContract["statuses"] {
  const statuses = new Map<number, { count: number; message: string | null }>();
  for (const log of logs) {
    const entry = statuses.get(log.statusCode) ?? {
      count: 0,
      message: log.error?.message ?? null,
    };
    entry.count += 1;
    statuses.set(log.statusCode, entry);
  }
  return [...statuses]
    .map(([status, entry]) => ({ status, ...entry }))
    .sort((a, b) => a.status - b.status);
}

/** Infer the contract of a route from its last logged requests. */
export async function observeContract(
  model: RequestLogModel,
  method: string,
  path: string,
): Promise<ObservedContract> {
  const { results } = await model.query({
    method,
    uri: path,
    limit: CONTRACT_SAMPLE,
  });
  const successful = results.filter((log) => log.statusCode < 400);
  const bodies = successful
    .map((log) => parseJson(log.requestBody))
    .filter(isRecord);
  const queryParams = new Set<string>();
  for (const log of results) {
    for (const key of Object.keys(log.query ?? {})) queryParams.add(key);
  }
  return {
    exampleBody: bodies[0] ?? null,
    bodyFields: inferBodyFields(bodies),
    queryParams: [...queryParams].sort(),
    statuses: observedStatuses(results),
    sampled: results.length,
  };
}

/** One step of the request pipeline, in the order it runs. */
export interface PipelineStep {
  kind: "prefix" | "handler" | "postfix" | "monitor";
  name: string;
  location: string;
  priority?: number;
  isAuth: boolean;
}

const MIDDLEWARE_STAGE: Record<MiddlewareInfo["mode"], number> = {
  prefix: 0,
  postfix: 2,
  monitor: 3,
};

/** Middleware and handler of a route, in the order a request meets them. */
export function pipelineOf(inspection: RouteInspection): PipelineStep[] {
  const steps = inspection.applicableMiddleware.map((middleware) => ({
    stage: MIDDLEWARE_STAGE[middleware.mode],
    step: {
      kind: middleware.mode,
      name: middleware.callbackName,
      location: middleware.location,
      priority: middleware.priority,
      isAuth: middleware.isAuth,
    } as PipelineStep,
  }));
  steps.push({
    stage: 1,
    step: {
      kind: "handler",
      name: inspection.controllerName
        ? `${inspection.controllerName}.${inspection.callbackName}`
        : inspection.callbackName,
      location: inspection.location,
      priority: inspection.priority,
      isAuth: false,
    },
  });
  return steps
    .sort(
      (a, b) =>
        a.stage - b.stage || (a.step.priority ?? 2) - (b.step.priority ?? 2),
    )
    .map(({ step }) => step);
}

const AUTH_PROVIDER = /authori[sz]ation|AuthUser|AuthRawUser|authenticat/i;

/**
 * Whether a call needs a signed-in user: an auth middleware runs before the
 * handler, or one of its parameters reads the session. Inferred, like the
 * rest of the introspection.
 */
export function requiresAuth(inspection: RouteInspection): boolean {
  return (
    inspection.applicableMiddleware.some(
      (middleware) => middleware.isAuth && middleware.mode === "prefix",
    ) ||
    inspection.parameters.some((parameter) =>
      AUTH_PROVIDER.test(parameter.rawProviderSource ?? ""),
    )
  );
}

/** Everything the Routes page shows about a route, around its tabs. */
export interface RouteDetail {
  ref: string;
  method: string;
  path: string;
  folder: string;
  controller: string | null;
  handler: string;
  module: string | null;
  own: boolean | null;
  requiresAuth: boolean;
  registeredAt: string | null;
  state: RouteState;
  pathParams: string[];
  pipeline: PipelineStep[];
  inspection: RouteInspection;
  contract: ObservedContract;
}

/** The route a `METHOD /path` reference names, with its contract. */
export async function getRouteDetail(
  models: CatalogModels,
  ref: string,
  now: Date = new Date(),
): Promise<RouteDetail | undefined> {
  const inspection = findRoute(ref);
  if (!inspection) return undefined;
  const method = inspection.method.toUpperCase();
  const range = { from: new Date(now.getTime() - 7 * MS_PER_DAY), to: now };
  const [stored, contract, traffic] = await Promise.all([
    models.routes.getByRoute(method, inspection.location),
    observeContract(models.logs, method, inspection.location),
    loadTraffic(
      models,
      range,
      "day",
      new Set([scopeRouteKey(method, inspection.location)]),
    ),
  ]);
  return {
    ref: routeRef(method, inspection.location),
    method,
    path: inspection.location,
    folder: folderOf(inspection.location),
    controller: inspection.controllerName,
    handler: inspection.callbackName,
    module: inspection.module ?? stored?.module ?? null,
    own: stored ? stored.own : null,
    requiresAuth: requiresAuth(inspection),
    registeredAt: stored?.createdAt?.toISOString() ?? null,
    state: stateOf(sumBuckets(traffic)),
    pathParams: inspection.location
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1)),
    pipeline: pipelineOf(inspection),
    inspection,
    contract,
  };
}
