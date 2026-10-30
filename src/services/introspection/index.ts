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
  type RouteHandler,
  type RouteHandlerMode,
} from "@antelopejs/interface-api";
import { isFunction } from "@/guards";
import { isAuthMiddleware } from "./auth";
import {
  controllerClass,
  type ControllerDecorators,
  controllerDecorators,
  type DecoratedParameter,
  isAuthDecorator,
} from "./decorators";
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
  /** The decorator that declared it, when the compiled source names it. */
  decorator?: string;
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
  /** Class name of the controller declaring the handler, when it has one. */
  controllerName: string | null;
  /** Module that registered the route, when the runtime could tell. */
  module: string | null;
  priority?: number;
  parameters: ParameterInfo[];
  properties: PropertyInfo[];
  applicableMiddleware: MiddlewareInfo[];
  errorCodes: InferredErrorCode[];
  /**
   * The authentication guards found around the handler: auth middleware
   * before it, guard decorators on its parameters, its class or members.
   */
  authGuards: string[];
}

const MIDDLEWARE_MODES: readonly MiddlewareMode[] = [
  "prefix",
  "postfix",
  "monitor",
];

function isMiddlewareMode(mode: RouteHandlerMode): mode is MiddlewareMode {
  return MIDDLEWARE_MODES.some((middlewareMode) => middlewareMode === mode);
}

const PARAMETER_SOURCES: readonly ParameterSource[] = [
  "param",
  "query",
  "header",
];

function isParameterSource(source: string): source is ParameterSource {
  return PARAMETER_SOURCES.some(
    (parameterSource) => parameterSource === source,
  );
}

const DECLARED_TYPES: Record<string, InferredType> = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
  Object: "object",
  Buffer: "buffer",
};

/**
 * What its decorator says about a parameter, over what its provider showed:
 * the stock @Parameter keeps its name in a closure, and a provider crossing a
 * module boundary is a proxy whose source is unreadable.
 */
function declaredParameter(
  decorated: DecoratedParameter,
): Partial<ParameterInfo> | undefined {
  if (isAuthDecorator(decorated.decorator)) {
    return {
      source: "auth",
      inferredType: "object",
      hint: decorated.decorator,
    };
  }
  if (
    decorated.decorator !== "Parameter" &&
    decorated.decorator !== "MultiParameter"
  ) {
    return undefined;
  }
  const [name, source = "param"] = decorated.args;
  if (!name || !source || !isParameterSource(source)) return undefined;
  const multi = decorated.decorator === "MultiParameter";
  return {
    name,
    source,
    multi,
    inferredType: multi
      ? "object"
      : (DECLARED_TYPES[decorated.type ?? ""] ?? "string"),
  };
}

function inspectParameter(
  param: ComputedParameter | null,
  index: number,
  decorated: DecoratedParameter | undefined,
): ParameterInfo {
  const probed = probeProvider(param);
  const info: ParameterInfo = {
    index,
    name: probed.name,
    source: probed.source,
    multi: probed.multi,
    inferredType: probed.inferredType,
    modifierCount: param?.modifiers.length ?? 0,
    decorator: decorated?.decorator,
    rawProviderSource: probed.rawProviderSource,
    hint: probed.hint,
  };
  const declared = decorated ? declaredParameter(decorated) : undefined;
  return declared
    ? { ...info, ...declared, rawProviderSource: undefined }
    : info;
}

function inspectProperties(
  properties: Record<string, ComputedParameter>,
  decorators: ControllerDecorators | undefined,
): PropertyInfo[] {
  return Object.entries(properties).map(([key, param]) => {
    const probed = probeProperty(param);
    const guard = decorators?.propertyDecorators[key]?.find(isAuthDecorator);
    return {
      key,
      decorator: guard ?? probed.decorator,
      modifierCount: param.modifiers.length,
      rawProviderSource: guard ? undefined : probed.rawProviderSource,
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

function toMiddlewareInfo(
  id: string,
  handler: RouteHandler,
  mode: MiddlewareMode,
): MiddlewareInfo {
  const callbackName = handler.callback.name || "anonymous";
  return {
    id,
    mode,
    location: handler.location,
    method: handler.method,
    callbackName,
    priority: handler.priority,
    isAuth: isAuthMiddleware({ callbackName }),
  };
}

function listMiddlewareEntries() {
  return getRegisteredRouteHandlers().flatMap(({ id, handler }) => {
    const { mode } = handler;
    return isMiddlewareMode(mode) ? [{ id, handler, mode }] : [];
  });
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
    .map(({ id, handler, mode }) => toMiddlewareInfo(id, handler, mode));
}

function comparePriorityThenMode(
  a: { handler: RouteHandler },
  b: { handler: RouteHandler },
): number {
  const modeOrder = {
    prefix: 0,
    postfix: 1,
    monitor: 2,
    handler: 3,
    websocket: 4,
  } satisfies Record<RouteHandlerMode, number>;
  const am = modeOrder[a.handler.mode] ?? 99;
  const bm = modeOrder[b.handler.mode] ?? 99;
  if (am !== bm) return am - bm;
  const ap = a.handler.priority ?? 2;
  const bp = b.handler.priority ?? 2;
  return ap - bp;
}

function controllerNameOf(handler: RouteHandler): string | null {
  const name = controllerClass(handler)?.name;
  return name && name !== "Object" ? name : null;
}

/**
 * The handler as written. The callback the runtime hands out can be a proxy
 * whose source is unreadable; the controller prototype, passed as is, still
 * holds the method itself.
 */
export function handlerMethod(
  handler: Pick<RouteHandler, "callback" | "proto">,
): Function {
  const name = handler.callback.name;
  const method: unknown = name ? handler.proto?.[name] : undefined;
  return isFunction(method) ? method : handler.callback;
}

function authGuardsOf(
  parameters: ParameterInfo[],
  properties: PropertyInfo[],
  middleware: MiddlewareInfo[],
  decorators: ControllerDecorators | undefined,
): string[] {
  return [
    ...new Set([
      ...middleware
        .filter((entry) => entry.isAuth && entry.mode === "prefix")
        .map((entry) => entry.callbackName),
      ...(decorators?.classDecorators.filter(isAuthDecorator) ?? []),
      ...properties
        .map((property) => property.decorator)
        .filter(
          (decorator) => decorator === "Auth" || isAuthDecorator(decorator),
        ),
      ...parameters
        .filter((parameter) => parameter.source === "auth")
        .map((parameter) => parameter.decorator ?? "authentication"),
    ]),
  ];
}

function inspectHandler(id: string, handler: RouteHandler): RouteInspection {
  const isHandler = handler.mode === "handler";
  const callbackName = handler.callback.name || "anonymous";
  const decorators = isHandler ? controllerDecorators(handler) : undefined;
  const decorated = decorators?.methods[callbackName] ?? [];
  const parameters = handler.parameters.map((param, index) =>
    inspectParameter(
      param,
      index,
      decorated.find((entry) => entry.index === index),
    ),
  );
  const properties = inspectProperties(handler.properties, decorators);
  const middleware = isHandler
    ? applicableMiddleware(handler.location, handler.method)
    : [];
  return {
    id,
    location: handler.location,
    method: handler.method,
    mode: handler.mode,
    callbackName,
    controllerName: controllerNameOf(handler),
    module: handler.module ?? null,
    priority: handler.priority,
    parameters,
    properties,
    applicableMiddleware: middleware,
    errorCodes: isHandler ? probeHandlerErrors(handlerMethod(handler)) : [],
    authGuards: authGuardsOf(parameters, properties, middleware, decorators),
  };
}

export function getRouteInspection(id: string): RouteInspection | undefined {
  const registered = getRegisteredRouteHandlers().find(
    (route) => route.id === id,
  );
  if (!registered) return undefined;
  return inspectHandler(registered.id, registered.handler);
}
