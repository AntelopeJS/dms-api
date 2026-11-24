import { createHash } from "node:crypto";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RouteWatchModel } from "@/db/models/route_watch.model";
import type { WatchedRoute } from "@/db/tables/route_watch.table";
import { routeLink } from "./links";
import { listRoutes, parseRouteRef, type RouteRow } from "./route-catalog";
import { getOwnRouteModules } from "./routes-sync";

/** A route registered or removed since the previous poll. */
export type RouteChange = {
  route: string;
  method: string;
  path: string;
  module: string | null;
  own: boolean | null;
  controller: string | null;
  routePath: string;
};

/** What changed between two polls, recorded once cluster-wide. */
export interface RouteWatchDiff {
  deliveryId: string;
  registered: RouteChange[];
  removed: RouteChange[];
  checkedAt: Date;
}

/** One armed reader of the watch. */
export interface RouteWatchListener {
  intervalMs: number;
  onDiff(diff: RouteWatchDiff): void;
}

/** What the watch reads and writes its last seen set through. */
export type RouteWatchStore = Pick<
  RouteWatchModel,
  "current" | "create" | "replace"
>;

const SHORT_HASH_LENGTH = 16;

function revisionOf(refs: string[]): string {
  return createHash("sha256")
    .update([...refs].sort().join("\n"))
    .digest("hex");
}

function watched(rows: RouteRow[], own: ReadonlySet<string>): WatchedRoute[] {
  return rows.map((row) => ({
    ref: row.ref,
    module: row.module,
    own: row.module !== null && own.has(row.module),
  }));
}

function registeredChange(
  row: RouteRow,
  own: ReadonlySet<string>,
): RouteChange {
  return {
    route: row.ref,
    method: row.method,
    path: row.path,
    module: row.module,
    own: row.module !== null && own.has(row.module),
    controller: row.controller,
    routePath: routeLink(row.ref),
  };
}

function removedChange(route: WatchedRoute): RouteChange {
  const parsed = parseRouteRef(route.ref);
  return {
    route: route.ref,
    method: parsed?.method ?? "",
    path: parsed?.path ?? "",
    module: route.module,
    own: route.own,
    controller: null,
    routePath: routeLink(route.ref),
  };
}

/**
 * Compares the registered routes with the set last stored and records the
 * new one. The first poll ever only stores the set. Of two instances seeing
 * the same change, the one whose write lands reports it; the other gets
 * null, as for no change at all.
 */
export async function pollRouteWatch(
  store: RouteWatchStore = GetModel(RouteWatchModel),
  now: Date = new Date(),
): Promise<RouteWatchDiff | null> {
  const rows = listRoutes(null);
  const revision = revisionOf(rows.map((row) => row.ref));
  const stored = await store.current();
  if (stored?.revision === revision) return null;
  const own = await getOwnRouteModules();
  if (!stored) {
    await store.create(watched(rows, own), revision);
    return null;
  }
  const before = new Set(stored.routes.map((route) => route.ref));
  const after = new Set(rows.map((row) => row.ref));
  if (!(await store.replace(stored.revision, watched(rows, own), revision))) {
    return null;
  }
  return {
    deliveryId: `api.route-registered:${stored.revision.slice(0, SHORT_HASH_LENGTH)}:${revision.slice(0, SHORT_HASH_LENGTH)}`,
    registered: rows
      .filter((row) => !before.has(row.ref))
      .map((row) => registeredChange(row, own)),
    removed: stored.routes
      .filter((route) => !after.has(route.ref))
      .map(removedChange),
    checkedAt: now,
  };
}

/** A shared poll of the registered routes, and its armed listeners. */
export interface RouteWatch {
  /**
   * Arms `listener`: one shared poll runs while any listener is armed, at
   * the shortest interval asked, and every listener hears the same diffs.
   * The returned function disarms it.
   */
  watch(listener: RouteWatchListener): () => void;
  /** Disarms every listener and stops the poll. */
  stop(): void;
}

/** A route watch over the set `store` keeps. */
export function createRouteWatch(store: () => RouteWatchStore): RouteWatch {
  const listeners = new Set<RouteWatchListener>();
  let timer: NodeJS.Timeout | undefined;
  let timerIntervalMs: number | undefined;
  let polling = false;

  const poll = async (): Promise<void> => {
    if (polling || listeners.size === 0) return;
    polling = true;
    try {
      const diff = await pollRouteWatch(store());
      if (!diff) return;
      for (const listener of listeners) {
        try {
          listener.onDiff(diff);
        } catch (err) {
          Logging.Error("[dms-api] route watch listener failed:", err);
        }
      }
    } catch (err) {
      Logging.Error("[dms-api] route watch poll failed:", err);
    } finally {
      polling = false;
    }
  };

  const rearm = (): void => {
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      timerIntervalMs = undefined;
      return;
    }
    const intervalMs = Math.min(
      ...[...listeners].map((listener) => listener.intervalMs),
    );
    if (timer && intervalMs === timerIntervalMs) return;
    const first = !timer;
    clearInterval(timer);
    timerIntervalMs = intervalMs;
    timer = setInterval(() => void poll(), intervalMs);
    if (first) void poll();
  };

  return {
    watch(listener) {
      listeners.add(listener);
      rearm();
      return () => {
        listeners.delete(listener);
        rearm();
      };
    },
    stop() {
      listeners.clear();
      rearm();
    },
  };
}

/** The module's route watch, over the `route_watch` table. */
export const routeWatch = createRouteWatch(() => GetModel(RouteWatchModel));
