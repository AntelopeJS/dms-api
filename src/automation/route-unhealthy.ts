import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { RouteStatisticsModel } from "@/db";
import {
  getWatchList,
  type WatchListItem,
} from "@/services/statistics-aggregate";
import { activeScopeKeys } from "./scope";

type Flag = WatchListItem["flag"];

interface RouteUnhealthyConfig {
  intervalSeconds?: number;
  flags?: Flag[];
}

interface RouteUnhealthyHandle {
  /** Set by activate once the poll loop is armed, not at construction. */
  timer?: NodeJS.Timeout;
  /** Last observed flag per routeKey; emissions happen on transitions only. */
  previousFlags: Map<string, Flag>;
  /** Set by deactivate; an in-flight poll checks it before emitting. */
  stopped: boolean;
}

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 10;
const DEFAULT_FLAGS: Flag[] = ["broken", "slow"];

export const routeUnhealthyTrigger: TriggerType<
  RouteUnhealthyConfig,
  WatchListItem
> = {
  id: "api.route-unhealthy",
  name: "Route unhealthy",
  description:
    "Fires when a route on the API watch list enters a monitored bad state (broken, slow or warn)",
  icon: "i-ph-warning",
  cluster: "singleton",
  configSchema: {
    type: "object",
    properties: {
      intervalSeconds: {
        type: "number",
        title: "Poll interval (seconds)",
        default: DEFAULT_INTERVAL_SECONDS,
        minimum: MIN_INTERVAL_SECONDS,
      },
      flags: {
        type: "array",
        title: "Flags to watch",
        items: { type: "string", enum: ["broken", "slow", "warn"] },
        default: DEFAULT_FLAGS,
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      routeKey: { type: "string" },
      method: { type: "string" },
      uri: { type: "string" },
      flag: { type: "string", enum: ["broken", "slow", "warn"] },
      errorRate: { type: "number" },
      averageLatencyMs: { type: "number" },
      requestsLast24h: { type: "number" },
    },
  },
  async activate(config, emit) {
    const intervalMs =
      Math.max(
        config.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
        MIN_INTERVAL_SECONDS,
      ) * 1000;
    const monitored = new Set<Flag>(
      config.flags?.length ? config.flags : DEFAULT_FLAGS,
    );
    const previousFlags = new Map<string, Flag>();
    // The first poll seeds the baseline without emitting, so (re)activation
    // does not re-alert for routes that were already unhealthy.
    let seeded = false;
    let polling = false;
    const handle: RouteUnhealthyHandle = {
      previousFlags,
      stopped: false,
    };

    const poll = async () => {
      if (polling || handle.stopped) return;
      polling = true;
      try {
        const keys = await activeScopeKeys();
        // Infinity: transitions are tracked here, never a truncated top-N.
        const items = await getWatchList(
          GetModel(RouteStatisticsModel),
          Number.POSITIVE_INFINITY,
          keys,
        );
        const seen = new Set<string>();
        for (const item of items) {
          seen.add(item.routeKey);
          const previous = previousFlags.get(item.routeKey);
          previousFlags.set(item.routeKey, item.flag);
          if (
            seeded &&
            !handle.stopped &&
            previous !== item.flag &&
            monitored.has(item.flag)
          ) {
            emit(item);
          }
        }
        // Routes gone from the list recovered; forget them so a relapse fires.
        for (const key of previousFlags.keys()) {
          if (!seen.has(key)) previousFlags.delete(key);
        }
        seeded = true;
      } catch (err) {
        // Never let a failing poll kill the interval.
        Logging.Error("[dms-api] route-unhealthy poll failed:", err);
      } finally {
        polling = false;
      }
    };

    void poll();
    handle.timer = setInterval(() => void poll(), intervalMs);
    return handle;
  },
  async deactivate(handle) {
    const h = handle as RouteUnhealthyHandle | undefined;
    if (!h) return;
    h.stopped = true;
    clearInterval(h.timer);
  },
};
