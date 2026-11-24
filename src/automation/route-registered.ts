import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import {
  type RouteChange,
  type RouteWatch,
  type RouteWatchDiff,
  routeWatch,
} from "@/services/route-watch";
import {
  DATE_TIME,
  INTERVAL_CONFIG,
  nullable,
  objectSchema,
  PATH_PREFIX_INPUT,
  POLL_BOUNDS,
  pollIntervalMs,
} from "./outputs";

type RouteChangeKind = "registered" | "removed";

interface RouteRegisteredConfig {
  intervalSeconds?: number;
  changes?: RouteChangeKind[];
  scope?: "all" | "own" | "modules";
  pathPrefix?: string;
}

type RouteRegisteredOutput = {
  deliveryId: string;
  registered: RouteChange[];
  removed: RouteChange[];
  registeredCount: number;
  removedCount: number;
  truncated: boolean;
  checkedAt: string;
};

interface RouteRegisteredHandle {
  stop(): void;
}

const MAX_LISTED = 200;
const DEFAULT_CHANGES: RouteChangeKind[] = ["registered", "removed"];

function keeps(config: RouteRegisteredConfig) {
  const prefix = config.pathPrefix
    ? normalizeRoutePath(config.pathPrefix)
    : undefined;
  return (change: RouteChange) => {
    if (config.scope === "own" && change.own !== true) return false;
    if (config.scope === "modules" && change.own !== false) return false;
    if (
      prefix &&
      prefix !== "/" &&
      change.path !== prefix &&
      !change.path.startsWith(`${prefix}/`)
    )
      return false;
    return true;
  };
}

/**
 * The emission one activation makes of a diff, or null when its filters
 * leave nothing: each list filtered, then cut at 200.
 */
export function routeChangesFor(
  config: RouteRegisteredConfig,
  diff: RouteWatchDiff,
): RouteRegisteredOutput | null {
  const changes = new Set(
    config.changes?.length ? config.changes : DEFAULT_CHANGES,
  );
  const keep = keeps(config);
  const registered = changes.has("registered")
    ? diff.registered.filter(keep)
    : [];
  const removed = changes.has("removed") ? diff.removed.filter(keep) : [];
  if (registered.length === 0 && removed.length === 0) return null;
  return {
    deliveryId: diff.deliveryId,
    registered: registered.slice(0, MAX_LISTED),
    removed: removed.slice(0, MAX_LISTED),
    registeredCount: registered.length,
    removedCount: removed.length,
    truncated: registered.length > MAX_LISTED || removed.length > MAX_LISTED,
    checkedAt: diff.checkedAt.toISOString(),
  };
}

const ROUTE_CHANGE_SCHEMA = objectSchema({
  route: { type: "string", description: "METHOD /path" },
  method: { type: "string" },
  path: { type: "string" },
  module: nullable("string"),
  own: nullable("boolean", {
    description:
      "From the project's own code; as last seen for a removed route",
  }),
  controller: nullable("string", { description: "Null for a removed route" }),
  routePath: { type: "string" },
});

/** The trigger, armed on `watch`. */
export function routeRegisteredTriggerOf(
  watch: RouteWatch = routeWatch,
): TriggerType<
  RouteRegisteredConfig,
  RouteRegisteredOutput,
  RouteRegisteredHandle
> {
  return {
    id: "api.route-registered",
    name: "Routes changed",
    description:
      "Fires when API routes are registered or removed: a deploy, a module loaded or unloaded, a webhook armed. One run per change, listing the routes",
    icon: "i-ph-plugs-connected",
    cluster: "singleton",
    configSchema: {
      type: "object",
      properties: {
        intervalSeconds: {
          ...INTERVAL_CONFIG,
          description:
            "The routes are polled once for every activation, at the shortest interval armed",
        },
        changes: {
          type: "array",
          title: "Changes that fire",
          items: { type: "string", enum: ["registered", "removed"] },
          default: DEFAULT_CHANGES,
          minItems: 1,
          uniqueItems: true,
        },
        scope: {
          type: "string",
          enum: ["all", "own", "modules"],
          default: "all",
          description: "own: the project's routes; modules: installed modules'",
        },
        pathPrefix: {
          ...PATH_PREFIX_INPUT,
          description: "Only routes under this path",
        },
      },
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      deliveryId: { type: "string" },
      registered: {
        type: "array",
        items: ROUTE_CHANGE_SCHEMA,
        maxItems: MAX_LISTED,
      },
      removed: {
        type: "array",
        items: ROUTE_CHANGE_SCHEMA,
        maxItems: MAX_LISTED,
      },
      registeredCount: { type: "integer", description: "Before the cut" },
      removedCount: { type: "integer", description: "Before the cut" },
      truncated: { type: "boolean" },
      checkedAt: DATE_TIME,
    }),
    /**
     * Arms the shared route watch, which compares the registered routes with
     * the set it stored last, across restarts: a deploy's new routes are seen
     * at its first poll. The very first poll only stores the set.
     */
    async activate(config, emit) {
      const stop = watch.watch({
        intervalMs: pollIntervalMs(config.intervalSeconds, POLL_BOUNDS),
        onDiff(diff) {
          const output = routeChangesFor(config, diff);
          if (output) emit(output);
        },
      });
      return { stop };
    },
    async deactivate(handle) {
      handle.stop();
    },
  };
}

export const routeRegisteredTrigger = routeRegisteredTriggerOf();
