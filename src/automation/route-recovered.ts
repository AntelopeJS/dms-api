import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import { routeLink, routeRef } from "@/services/links";
import { loadRouteHealth } from "@/services/overview";
import type { RouteHealthState } from "@/services/route-health";
import {
  ROUTE_FLAGS,
  type RouteFlag,
  routeFlag,
} from "@/services/statistics-aggregate";
import { errorShare } from "@/services/traffic";
import {
  DATE_TIME,
  INTERVAL_CONFIG,
  nullable,
  objectSchema,
  POLL_BOUNDS,
  pollIntervalMs,
  pollMinute,
} from "./outputs";
import { activeScopeKeys } from "./scope";

interface RouteRecoveredConfig {
  intervalSeconds?: number;
  flags?: RouteFlag[];
}

type RecoveredState = "recovered" | "healthy" | "idle";

type RouteRecoveredOutput = {
  deliveryId: string;
  routeKey: string;
  route: string;
  method: string;
  uri: string;
  previousFlag: RouteFlag;
  state: RecoveredState;
  incidentStart: string | null;
  incidentEnd: string | null;
  requestsLast24h: number;
  errorRate: number;
  p95Ms: number | null;
  routePath: string;
  checkedAt: string;
};

interface RouteRecoveredHandle {
  timer?: NodeJS.Timeout;
  stopped: boolean;
}

interface Seen {
  method: string;
  uri: string;
  flag: RouteFlag | null;
}

const DEFAULT_FLAGS: RouteFlag[] = ["broken", "slow"];

function recoveredState(route: RouteHealthState | undefined): RecoveredState {
  if (!route || route.state === "idle") return "idle";
  return route.state === "recovered" ? "recovered" : "healthy";
}

/**
 * The recovery `route` shows after a poll that saw it flagged `previous`, or
 * null when it still carries a flag (the same or another one). A route gone
 * from the health map is idle: no traffic left in the lookback.
 */
export function recoveryOf(
  previous: Seen,
  key: string,
  route: RouteHealthState | undefined,
  checkedAt: Date,
): RouteRecoveredOutput | null {
  if (!previous.flag) return null;
  if (route && routeFlag(route.state)) return null;
  const state = recoveredState(route);
  const ref = routeRef(previous.method, previous.uri);
  const incidentEnd = route?.incident?.end?.toISOString() ?? null;
  return {
    deliveryId: `api.route-recovered:${key}:${previous.flag}:${incidentEnd ?? pollMinute(checkedAt)}`,
    routeKey: key,
    route: ref,
    method: previous.method,
    uri: previous.uri,
    previousFlag: previous.flag,
    state,
    incidentStart: route?.incident?.start?.toISOString() ?? null,
    incidentEnd,
    requestsLast24h: route?.traffic.requests ?? 0,
    errorRate: route ? errorShare(route.traffic) : 0,
    p95Ms: route?.p95Ms ?? null,
    routePath: routeLink(ref),
    checkedAt: checkedAt.toISOString(),
  };
}

/** Every route judged by the health rules, and the keys of the scope (null: all). */
export interface RouteHealthSnapshot {
  keys: Set<string> | null;
  routes: Map<string, RouteHealthState>;
}

/** The routes' health over the last 24 h under the saved scope. */
export async function readRouteHealth(): Promise<RouteHealthSnapshot> {
  const keys = await activeScopeKeys();
  const { routes } = await loadRouteHealth({ logs: GetModel(RequestLogModel) });
  return { keys, routes };
}

/** The trigger, polling the routes' health `read` answers. */
export function routeRecoveredTriggerOf(
  read: () => Promise<RouteHealthSnapshot> = readRouteHealth,
): TriggerType<
  RouteRecoveredConfig,
  RouteRecoveredOutput,
  RouteRecoveredHandle
> {
  return {
    id: "api.route-recovered",
    name: "Route recovered",
    description:
      "Fires when a route that was broken, slow or answering many 4xx is healthy again, by the API health rules",
    icon: "i-ph-check-circle",
    cluster: "singleton",
    configSchema: {
      type: "object",
      properties: {
        intervalSeconds: INTERVAL_CONFIG,
        flags: {
          type: "array",
          title: "Flags whose end fires",
          items: { type: "string", enum: [...ROUTE_FLAGS] },
          default: DEFAULT_FLAGS,
          minItems: 1,
          uniqueItems: true,
        },
      },
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      deliveryId: { type: "string" },
      routeKey: { type: "string", description: "METHOD:uri" },
      route: { type: "string", description: "METHOD /path" },
      method: { type: "string" },
      uri: { type: "string" },
      previousFlag: { type: "string", enum: [...ROUTE_FLAGS] },
      state: { type: "string", enum: ["recovered", "healthy", "idle"] },
      incidentStart: nullable("string", { format: "date-time" }),
      incidentEnd: nullable("string", { format: "date-time" }),
      requestsLast24h: { type: "integer" },
      errorRate: { type: "number", minimum: 0, maximum: 1 },
      p95Ms: nullable("number"),
      routePath: { type: "string" },
      checkedAt: DATE_TIME,
    }),
    /**
     * Polls every route in scope and emits when a route a previous poll saw
     * with a watched flag carries none any more. The first poll seeds the
     * baseline silently; a route leaving the scope is forgotten.
     */
    async activate(config, emit) {
      const watched = new Set<RouteFlag>(
        config.flags?.length ? config.flags : DEFAULT_FLAGS,
      );
      const handle: RouteRecoveredHandle = { stopped: false };
      let seen: Map<string, Seen> | undefined;
      let polling = false;

      const poll = async () => {
        if (polling || handle.stopped) return;
        polling = true;
        try {
          const checkedAt = new Date();
          const { keys, routes } = await read();
          const next = new Map<string, Seen>();
          for (const route of routes.values()) {
            if (keys && !keys.has(route.key)) continue;
            next.set(route.key, {
              method: route.method,
              uri: route.uri,
              flag: routeFlag(route.state),
            });
          }
          for (const [key, previous] of seen ?? []) {
            if (keys && !keys.has(key)) continue;
            if (!previous.flag || !watched.has(previous.flag)) continue;
            const recovery = recoveryOf(
              previous,
              key,
              routes.get(key),
              checkedAt,
            );
            if (recovery && !handle.stopped) emit(recovery);
          }
          seen = next;
        } catch (err) {
          Logging.Error("[dms-api] route-recovered poll failed:", err);
        } finally {
          polling = false;
        }
      };

      void poll();
      handle.timer = setInterval(
        () => void poll(),
        pollIntervalMs(config.intervalSeconds, POLL_BOUNDS),
      );
      return handle;
    },
    async deactivate(handle) {
      handle.stopped = true;
      clearInterval(handle.timer);
    },
  };
}

export const routeRecoveredTrigger = routeRecoveredTriggerOf();
