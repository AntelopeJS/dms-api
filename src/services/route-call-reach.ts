import {
  getRegisteredRouteHandlers,
  type RegisteredRouteHandler,
} from "@antelopejs/interface-api";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import {
  DMS_CONSOLE_PATH_PREFIXES,
  DMS_CONSOLE_PATHS,
  dmsModuleOf,
  type HandlerOwner,
  isDmsConsoleCall,
  isInternalTraffic,
} from "./request-log/capture";

/** The automation module's own API, which a procedure may not call. */
const AUTOMATION_API_PREFIX = "/api/automation";

/**
 * The DMS's account and onboarding endpoints: sign-in, password, two
 * factor, sessions, workspace switch. Refused on the DMS's own handlers, and
 * on any handler whose module is unknown.
 */
export const DMS_ACCOUNT_PATH_PREFIXES: readonly string[] = [
  "/api/auth",
  "/api/onboarding",
];

function under(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Whether a path is refused whoever answers it: the console, the DMS plumbing, page layouts, the automation API. */
function isAlwaysRefusedPath(path: string): boolean {
  const canonical = normalizeRoutePath(path);
  return (
    isInternalTraffic(canonical) || under(canonical, [AUTOMATION_API_PREFIX])
  );
}

/**
 * Whether a handler is one a procedure may not reach: the console's, the
 * DMS's own console, account and onboarding endpoints, page layouts, the
 * automation API. A handler under a DMS prefix whose module is unknown is
 * refused too: it cannot be told from the DMS's.
 */
export function isRefusedHandler(
  handler: HandlerOwner,
  handlers: () => readonly HandlerOwner[],
): boolean {
  const path = normalizeRoutePath(handler.location);
  if (isAlwaysRefusedPath(path) || isInternalTraffic(path, handler.location))
    return true;
  if (isDmsConsoleCall(handler, handlers)) return true;
  const dmsPrefix =
    DMS_CONSOLE_PATHS.includes(path) ||
    under(path, DMS_CONSOLE_PATH_PREFIXES) ||
    under(path, DMS_ACCOUNT_PATH_PREFIXES);
  if (!dmsPrefix) return false;
  const dms = dmsModuleOf(handlers());
  return !handler.module || !dms || handler.module === dms;
}

/**
 * Whether a route pattern can answer the segments of a concrete path. Every
 * dynamic part (`:id`, `file.:ext`) matches any one segment and a catch-all
 * (`::rest`) any run of them, so a pattern the router could pick is never
 * missed.
 */
export function patternMatches(pattern: string, segments: string[]): boolean {
  const parts = pattern.split("/").filter(Boolean);
  const catchAll = parts.findIndex((part) => part.startsWith("::"));
  if (catchAll >= 0) {
    const head = parts.slice(0, catchAll);
    const tail = parts.slice(catchAll + 1);
    if (segments.length < head.length + tail.length + 1) return false;
    return (
      partsMatch(head, segments.slice(0, head.length)) &&
      partsMatch(tail, segments.slice(segments.length - tail.length))
    );
  }
  return parts.length === segments.length && partsMatch(parts, segments);
}

function partsMatch(parts: string[], segments: string[]): boolean {
  return parts.every(
    (part, index) => part.includes(":") || part === segments[index],
  );
}

function segmentsOf(path: string): string[][] {
  const encoded = path.split("/").filter(Boolean);
  let decoded: string[];
  try {
    decoded = decodeURIComponent(path).split("/").filter(Boolean);
  } catch {
    decoded = encoded;
  }
  return [encoded, decoded];
}

/**
 * Whether a concrete path a procedure is about to call can reach a refused
 * handler, whichever the router picks: the path itself is refused, or any
 * registered handler able to answer it (any method) is refused. Read as
 * sent and percent-decoded.
 */
export function reachesRefusedRoute(
  concretePath: string,
  registered: readonly RegisteredRouteHandler[] = getRegisteredRouteHandlers(),
): boolean {
  const handlers = registered
    .filter(({ handler }) => handler.mode === "handler")
    .map(({ handler }) => ({
      location: handler.location,
      module: handler.module,
    }));
  const owners = () => handlers;
  return segmentsOf(concretePath).some((segments) => {
    const path = `/${segments.join("/")}`;
    if (isAlwaysRefusedPath(path)) return true;
    return handlers.some(
      (handler) =>
        patternMatches(handler.location, segments) &&
        isRefusedHandler(handler, owners),
    );
  });
}
