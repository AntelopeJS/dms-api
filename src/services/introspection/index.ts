/**
 * Single swap-point for "data the AntelopeJS runtime doesn't yet expose".
 *
 * The Documentation, Configuration and Statistics tabs in the new Routes
 * page need parameter names, sources (Body/Query/Param/Header), middleware
 * lists scoped to a URL path, and the controller-class layout — none of
 * which are introspectable via `getRegisteredRoutes()`. This module
 * collects every workaround in one file so the abstraction can be replaced
 * wholesale when proper introspection lands.
 *
 * Public consumers should only depend on the types and functions exported
 * here.
 */

import {
  type ComputedParameter,
  getRegisteredRouteHandlers,
  type RegisteredRouteHandler,
  type RouteHandler,
  type RouteHandlerMode,
} from "@antelopejs/interface-api";
import { isAuthMiddleware } from "./auth";
import { type InferredErrorCode, probeHandlerErrors } from "./errors";
import {
  type InferredType,
  type ParameterSource,
  probeProperty,
  probeProvider,
} from "./probe";

export { isAuthMiddleware };
export type { InferredErrorCode, InferredType, ParameterSource };

export interface ParameterInfo {
  index: number;
  name: string | null;
  source: ParameterSource;
  multi: boolean;
  inferredType: InferredType;
  modifierCount: number;
  rawProviderSource?: string;
  hint?: string;
}

export interface PropertyInfo {
  key: string;
  decorator: string;
  modifierCount: number;
  rawProviderSource?: string;
  hint?: string;
}

export type MiddlewareMode = "prefix" | "postfix" | "monitor";

export interface MiddlewareInfo {
  id: string;
  mode: MiddlewareMode;
  location: string;
  method: string;
  callbackName: string;
  priority?: number;
  isAuth: boolean;
}

export interface RouteInspection {
  id: string;
  location: string;
  method: string;
  mode: RouteHandlerMode;
  callbackName: string;
  priority?: number;
  parameters: ParameterInfo[];
  properties: PropertyInfo[];
  applicableMiddleware: MiddlewareInfo[];
  errorCodes: InferredErrorCode[];
}

export interface FolderInspection {
  path: string;
  middlewareAtOrAbove: MiddlewareInfo[];
  routes: RouteInspection[];
}

const MIDDLEWARE_MODES: ReadonlySet<RouteHandlerMode> = new Set([
  "prefix",
  "postfix",
  "monitor",
]);

function inspectParameter(
  param: ComputedParameter | null,
  index: number,
): ParameterInfo {
  const probed = probeProvider(param);
  return {
    index,
    name: probed.name,
    source: probed.source,
    multi: probed.multi,
    inferredType: probed.inferredType,
    modifierCount: param?.modifiers.length ?? 0,
    rawProviderSource: probed.rawProviderSource,
    hint: probed.hint,
  };
}

function inspectProperties(
  properties: Record<string, ComputedParameter>,
): PropertyInfo[] {
  return Object.entries(properties).map(([key, param]) => {
    const probed = probeProperty(param);
    return {
      key,
      decorator: probed.decorator,
      modifierCount: param.modifiers.length,
      rawProviderSource: probed.rawProviderSource,
      hint: probed.hint,
    };
  });
}

/**
 * URL pattern match for middleware location.
 *
 * AntelopeJS dispatches prefix/postfix by path-segment tree: a middleware
 * registered at `/foo/bar` runs for any request whose URL begins with
 * `/foo/bar`. Method matching: a middleware with method `"any"` matches
 * any HTTP method, otherwise an exact match is required.
 *
 * Dynamic segments in the middleware location (`:id`) are treated as
 * wildcards against the route's literal segments. This is the same shape
 * the dispatch uses; we don't attempt to be smarter than that.
 */
function middlewareMatches(
  middlewareLocation: string,
  middlewareMethod: string,
  routeLocation: string,
  routeMethod: string,
): boolean {
  if (
    middlewareMethod !== "any" &&
    middlewareMethod.toLowerCase() !== routeMethod.toLowerCase()
  ) {
    return false;
  }
  return locationCovers(middlewareLocation, routeLocation);
}

function locationCovers(prefix: string, full: string): boolean {
  const prefixSegs = prefix.split("/").filter(Boolean);
  const fullSegs = full.split("/").filter(Boolean);
  if (prefixSegs.length > fullSegs.length) return false;
  for (let i = 0; i < prefixSegs.length; i++) {
    const a = prefixSegs[i];
    const b = fullSegs[i];
    if (a.startsWith(":") || a.startsWith("::")) continue;
    if (a !== b) return false;
  }
  return true;
}

function toMiddlewareInfo(id: string, handler: RouteHandler): MiddlewareInfo {
  const callbackName = handler.callback.name || "anonymous";
  return {
    id,
    mode: handler.mode as MiddlewareMode,
    location: handler.location,
    method: handler.method,
    callbackName,
    priority: handler.priority,
    isAuth: isAuthMiddleware({ callbackName }),
  };
}

function listMiddlewareEntries(): RegisteredRouteHandler[] {
  return getRegisteredRouteHandlers().filter(({ handler }) =>
    MIDDLEWARE_MODES.has(handler.mode),
  );
}

function applicableMiddleware(
  routeLocation: string,
  routeMethod: string,
): MiddlewareInfo[] {
  return listMiddlewareEntries()
    .filter(({ handler }) =>
      middlewareMatches(
        handler.location,
        handler.method,
        routeLocation,
        routeMethod,
      ),
    )
    .sort(comparePriorityThenMode)
    .map(({ id, handler }) => toMiddlewareInfo(id, handler));
}

function comparePriorityThenMode(
  a: { handler: RouteHandler },
  b: { handler: RouteHandler },
): number {
  const modeOrder: Record<string, number> = {
    prefix: 0,
    postfix: 1,
    monitor: 2,
    handler: 3,
    websocket: 4,
  };
  const am = modeOrder[a.handler.mode] ?? 99;
  const bm = modeOrder[b.handler.mode] ?? 99;
  if (am !== bm) return am - bm;
  const ap = a.handler.priority ?? 2;
  const bp = b.handler.priority ?? 2;
  return ap - bp;
}

function inspectHandler(id: string, handler: RouteHandler): RouteInspection {
  return {
    id,
    location: handler.location,
    method: handler.method,
    mode: handler.mode,
    callbackName: handler.callback.name || "anonymous",
    priority: handler.priority,
    parameters: handler.parameters.map(inspectParameter),
    properties: inspectProperties(handler.properties),
    applicableMiddleware:
      handler.mode === "handler"
        ? applicableMiddleware(handler.location, handler.method)
        : [],
    errorCodes:
      handler.mode === "handler" ? probeHandlerErrors(handler.callback) : [],
  };
}

export function getRouteInspection(id: string): RouteInspection | undefined {
  const registered = getRegisteredRouteHandlers().find(
    (route) => route.id === id,
  );
  if (!registered) return undefined;
  return inspectHandler(registered.id, registered.handler);
}

export function listRouteInspections(): RouteInspection[] {
  return getRegisteredRouteHandlers()
    .filter(({ handler }) => handler.mode === "handler")
    .map(({ id, handler }) => inspectHandler(id, handler));
}

export function getFolderInspection(urlPath: string): FolderInspection {
  const normalized = `/${urlPath.split("/").filter(Boolean).join("/")}`;
  const routes = listRouteInspections().filter((route) =>
    locationCovers(normalized, route.location),
  );
  const middlewareAtOrAbove = listMiddlewareEntries()
    .filter(({ handler }) => locationCovers(handler.location, normalized))
    .sort(comparePriorityThenMode)
    .map(({ id, handler }) => toMiddlewareInfo(id, handler));

  return {
    path: normalized,
    middlewareAtOrAbove,
    routes,
  };
}
