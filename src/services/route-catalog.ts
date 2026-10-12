import {
  getRegisteredRouteHandlers,
  type RegisteredRouteHandler,
} from "@antelopejs/interface-api";
import type { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import {
  getRouteInspection,
  type MiddlewareInfo,
  type RouteInspection,
} from "./introspection";
import { routeRef } from "./links";
import { isPageLayoutPath } from "./request-log/capture";
import {
  contractOf,
  type DocumentedParameter,
  documentParameters,
  loadContractTraffic,
  type ObservedContract,
  type ObservedStatus,
} from "./route-contract";
import { createMemo } from "@/memo";
import { CACHE_TTL_MS } from "./aggregate-cache";
import { scopeRouteKey } from "./scope";
import type { ScopeKeys } from "./traffic";

export interface CatalogModels {
  logs: RequestLogModel;
  stats: RouteStatisticsModel;
  routes: RouteModel;
}

/**
 * One route of the Routes tree. Its traffic and state are the Overview's
 * (see the routes controller), merged in by the caller.
 */
export interface RouteRow {
  ref: string;
  method: string;
  /**
   * Canonical path (see `normalizeRoutePath`): the one clients call, shown
   * and called by the Tester. The runtime matches it to the handler location
   * either way, empty segments aside.
   */
  path: string;
  /** Leading static segments the tree groups routes under. */
  folder: string;
  controller: string | null;
  handler: string;
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

/**
 * Registered handlers in scope, the DMS page layouts (`<page>/pagelayout`)
 * aside: the DMS registers one for every page, in the module that declares
 * the page, and the console never captures them.
 */
function routeHandlers(keys: ScopeKeys): RegisteredRouteHandler[] {
  return getRegisteredRouteHandlers().filter(
    ({ handler }) =>
      handler.mode === "handler" &&
      !isPageLayoutPath(handler.location) &&
      (!keys || keys.has(scopeRouteKey(handler.method, handler.location))),
  );
}

/**
 * Registered routes in scope: the count the tree lists, which the scope chip
 * and the health show too. The synced routes table may still hold a route no
 * longer registered.
 */
export function countRoutes(keys: ScopeKeys): number {
  return routeHandlers(keys).length;
}

/** Every registered route in scope. */
export function listRoutes(keys: ScopeKeys): RouteRow[] {
  return routeHandlers(keys)
    .map(({ handler }) => {
      const method = handler.method.toUpperCase();
      const path = normalizeRoutePath(handler.location);
      return {
        ref: routeRef(method, path),
        method,
        path,
        folder: folderOf(path),
        controller:
          (handler.proto as { constructor?: { name?: string } } | undefined)
            ?.constructor?.name ?? null,
        handler: handler.callback.name || "anonymous",
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
  return { method: match[1].toUpperCase(), path: normalizeRoutePath(match[2]) };
}

/** The registered handler a `METHOD /path` reference names. */
function findHandler(
  ref: string | undefined,
): RegisteredRouteHandler | undefined {
  const parsed = parseRouteRef(ref);
  if (!parsed) return undefined;
  return getRegisteredRouteHandlers().find(
    ({ handler }) =>
      handler.mode === "handler" &&
      handler.method.toUpperCase() === parsed.method &&
      normalizeRoutePath(handler.location) === parsed.path,
  );
}

/** Whether `ref` names a route the API registers (not a stray path). */
export function isRegisteredRoute(ref: string | undefined): boolean {
  return findHandler(ref) !== undefined;
}

export function findRoute(
  ref: string | undefined,
): RouteInspection | undefined {
  const found = findHandler(ref);
  return found ? getRouteInspection(found.id) : undefined;
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
      isAuth: inspection.authGuards.length > 0,
    },
  });
  return steps
    .sort(
      (a, b) =>
        a.stage - b.stage || (a.step.priority ?? 2) - (b.step.priority ?? 2),
    )
    .map(({ step }) => step);
}

/**
 * Whether a call needs a signed-in user, as the introspection sees it: an
 * auth middleware runs before the handler, a guard decorates it (the DMS
 * @AuthUserWithPermission…), or one of its parameters reads the session.
 */
export function requiresAuth(inspection: RouteInspection): boolean {
  return inspection.authGuards.length > 0;
}

/**
 * - `required`: a guard was found in the code;
 * - `probable`: none was found, but the route answered 401;
 * - `unknown`: neither. Never "public": the introspection can miss a check
 *   made inside the handler.
 */
export type AuthStatus = "required" | "probable" | "unknown";

export interface RouteAuth {
  status: AuthStatus;
  /** The guards found in the code. */
  guards: string[];
  /** 401 answers over the contract window. */
  unauthorized: number;
}

const HTTP_UNAUTHORIZED = 401;

/** What is known of a route's authentication, from its code and its traffic. */
export function authOf(
  inspection: RouteInspection,
  statuses: Array<Pick<ObservedStatus, "status" | "count">>,
): RouteAuth {
  const unauthorized =
    statuses.find((entry) => entry.status === HTTP_UNAUTHORIZED)?.count ?? 0;
  const guards = inspection.authGuards;
  let status: AuthStatus = "unknown";
  if (guards.length > 0) status = "required";
  else if (unauthorized > 0) status = "probable";
  return { status, guards, unauthorized };
}

/** Everything the Routes page shows about a route, around its tabs. */
export interface RouteDetail {
  ref: string;
  method: string;
  /** Canonical path, as in `RouteRow`; the pipeline keeps the handler's. */
  path: string;
  folder: string;
  controller: string | null;
  handler: string;
  module: string | null;
  own: boolean | null;
  /** Signed-in calls expected: a guard was found, or 401s were answered. */
  requiresAuth: boolean;
  auth: RouteAuth;
  registeredAt: string | null;
  pathParams: string[];
  parameters: DocumentedParameter[];
  pipeline: PipelineStep[];
  inspection: RouteInspection;
  contract: ObservedContract;
  /**
   * Where clients reach the API, for the snippets (see `apiOrigin`); null
   * when the DMS configuration clears it.
   */
  apiOrigin: string | null;
}

/**
 * The traffic contracts of the routes opened lately. Every block around the
 * selected route reads its detail, and reading a busy route's week of logs
 * is what costs.
 */
const contracts = createMemo(16, CACHE_TTL_MS);

/** The route a `METHOD /path` reference names, with its contract. */
export async function getRouteDetail(
  models: CatalogModels,
  ref: string,
  apiOrigin: string | null = null,
  now: Date = new Date(),
): Promise<RouteDetail | undefined> {
  const inspection = findRoute(ref);
  if (!inspection) return undefined;
  const method = inspection.method.toUpperCase();
  const path = normalizeRoutePath(inspection.location);
  const [stored, observed] = await Promise.all([
    models.routes.getByRoute(method, inspection.location),
    contracts.cached(`${method} ${path}`, () =>
      loadContractTraffic(models.logs, method, inspection.location, now),
    ),
  ]);
  const contract = contractOf(observed);
  const auth = authOf(inspection, contract.statuses);
  return {
    ref: routeRef(method, path),
    method,
    path,
    folder: folderOf(path),
    controller: inspection.controllerName,
    handler: inspection.callbackName,
    module: inspection.module ?? stored?.module ?? null,
    own: stored ? stored.own : null,
    requiresAuth: auth.status !== "unknown",
    auth,
    registeredAt: stored?.createdAt?.toISOString() ?? null,
    pathParams: inspection.location
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1)),
    parameters: documentParameters(
      inspection,
      observed.successful,
      contract.queryParams,
    ),
    pipeline: pipelineOf(inspection),
    inspection,
    contract,
    apiOrigin,
  };
}
