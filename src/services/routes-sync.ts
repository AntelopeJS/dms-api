import { getRegisteredRoutes } from "@antelopejs/interface-api";
import { GetModuleInfo, ListModules } from "@antelopejs/interface-core/modules";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { RouteStatisticsModel, type RouteModel } from "@/db";
import type { Route } from "@/db/tables/routes.table";
import {
  getRouteStatsKey,
  normalizeRouteMethod,
  normalizeRoutePath,
} from "@/db/tables/routes_statistics.table";
import { MONITORING_API_PREFIX } from "@/types";

type RegisteredRoute = ReturnType<typeof getRegisteredRoutes>[number];

/** The routes table, as a sync reads and writes it. */
type RoutesStore = Pick<
  RouteModel,
  "getAll" | "insert" | "update" | "delete" | "setCreatedAt"
>;

/** The statistics a sync reads the first day a route was called from. */
type StatisticsSource = Pick<RouteStatisticsModel, "getAll">;

/** `METHOD:path`, canonical: `/api/orders/` and `/api/orders` are one route. */
function getRouteKey(method: string, uri: string): string {
  return getRouteStatsKey(method, uri);
}

/**
 * Resolve the set of module ids considered "own": modules whose source is the
 * local project rather than a downloaded package. Routes registered by any
 * other module (or with no resolvable module) belong to the `modules` bucket.
 * A module that vanished between the list and its info is not own.
 */
export async function getOwnModuleIds(): Promise<Set<string>> {
  const ids = await ListModules();
  const own = new Set<string>();
  await Promise.all(
    ids.map(async (id: string) => {
      try {
        const info = await GetModuleInfo(id);
        if (info.source.type === "local") own.add(id);
      } catch {}
    }),
  );
  return own;
}

interface Ownership {
  module: string | null;
  own: boolean;
}

function ownershipOf(
  route: RegisteredRoute,
  ownModules: ReadonlySet<string>,
): Ownership {
  const module = route.module ?? null;
  return { module, own: module !== null && ownModules.has(module) };
}

/** Routes that exist in the DB but are no longer registered. */
function computeDeletes(
  existingByKey: Map<string, Route>,
  registeredByKey: Map<string, RegisteredRoute>,
): string[] {
  return [...existingByKey.entries()]
    .filter(([key]) => !registeredByKey.has(key))
    .map(([, route]) => route._id);
}

/** Routes that are registered but absent from the DB. */
function computeInserts(
  registeredByKey: Map<string, RegisteredRoute>,
  existingByKey: Map<string, Route>,
  ownModules: ReadonlySet<string>,
  now: Date,
) {
  return [...registeredByKey.entries()]
    .filter(([key]) => !existingByKey.has(key))
    .map(([, r]) => ({
      uri: normalizeRoutePath(r.location),
      method: normalizeRouteMethod(r.method),
      ...ownershipOf(r, ownModules),
      createdAt: now,
      updatedAt: now,
    }));
}

/** Existing rows whose module, or its own/module flag, changed. */
function computeUpdates(
  existingByKey: Map<string, Route>,
  registeredByKey: Map<string, RegisteredRoute>,
  ownModules: ReadonlySet<string>,
): Route[] {
  const routesToUpdate: Route[] = [];
  for (const [key, existing] of existingByKey) {
    const registered = registeredByKey.get(key);
    if (!registered) continue;
    const { module, own } = ownershipOf(registered, ownModules);
    if (existing.module === module && existing.own === own) continue;
    existing.module = module;
    existing.own = own;
    routesToUpdate.push(existing);
  }
  return routesToUpdate;
}

/**
 * The console's own endpoints are module routes, even when the console runs
 * from a local checkout (its playground, a fork): counting them as the
 * project's would make the dashboard watch itself polling.
 */
function withoutConsole(
  localModules: ReadonlySet<string>,
  registeredRoutes: RegisteredRoute[],
): ReadonlySet<string> {
  const consoleModule = registeredRoutes.find((route) =>
    route.location.startsWith(`${MONITORING_API_PREFIX}/`),
  )?.module;
  if (!consoleModule) return localModules;
  return new Set([...localModules].filter((id) => id !== consoleModule));
}

/** The first day each route was called, from its daily statistics. */
async function firstCalls(
  stats: StatisticsSource,
): Promise<Map<string, number>> {
  const first = new Map<string, number>();
  for (const route of await stats.getAll()) {
    const days = route.statistics.map((day) => day.day);
    if (days.length > 0) {
      first.set(getRouteKey(route.method, route.uri), Math.min(...days));
    }
  }
  return first;
}

/**
 * A route row is created when the console sees the route registered, and
 * deleted when it is no longer: a route that comes back (a module reloaded)
 * gets a new row, long after it was first called. Its creation date goes
 * back to its first recorded call, so it never reads "registered today" over
 * weeks of history.
 */
async function backdateToFirstCall(
  routesModel: RoutesStore,
  stats: StatisticsSource,
): Promise<void> {
  const [routes, first] = await Promise.all([
    routesModel.getAll(),
    firstCalls(stats),
  ]);
  const later = routes.flatMap((route) => {
    const day = first.get(getRouteKey(route.method, route.uri));
    return day !== undefined && (route.createdAt?.getTime() ?? Infinity) > day
      ? [{ id: route._id, day }]
      : [];
  });
  await Promise.all(
    later.map(({ id, day }) => routesModel.setCreatedAt(id, new Date(day))),
  );
}

/** Registered routes as a comparable string: what a sync last wrote. */
function signatureOf(registeredRoutes: RegisteredRoute[]): string {
  return registeredRoutes
    .map((r) => `${getRouteKey(r.method, r.location)}@${r.module ?? ""}`)
    .sort()
    .join("\n");
}

let syncedSignature: string | undefined;
let pendingSync: Promise<void> | undefined;

/**
 * Synchronize registered routes with the database: insert the new ones (with
 * their module and own/module flag), update those whose ownership changed,
 * delete those no longer registered, and date each from its first recorded
 * call when that is earlier.
 */
async function runSync(
  routesModel: RoutesStore,
  registeredRoutes: RegisteredRoute[],
  stats: StatisticsSource,
): Promise<void> {
  const [existingRoutes, localModules] = await Promise.all([
    routesModel.getAll(),
    getOwnModuleIds(),
  ]);
  const ownModules = withoutConsole(localModules, registeredRoutes);
  const now = new Date();

  const existingByKey = new Map(
    existingRoutes.map((route) => [
      getRouteKey(route.method, route.uri),
      route,
    ]),
  );
  const registeredByKey = new Map(
    registeredRoutes.map((r) => [getRouteKey(r.method, r.location), r]),
  );

  const idsToDelete = computeDeletes(existingByKey, registeredByKey);
  const routesToInsert = computeInserts(
    registeredByKey,
    existingByKey,
    ownModules,
    now,
  );
  const routesToUpdate = computeUpdates(
    existingByKey,
    registeredByKey,
    ownModules,
  );

  await Promise.all([
    ...idsToDelete.map((id) => routesModel.delete(id)),
    ...routesToInsert.map((r) => routesModel.insert(r)),
    ...routesToUpdate.map((r) => routesModel.update(r)),
  ]);
  await backdateToFirstCall(routesModel, stats);
  syncedSignature = signatureOf(registeredRoutes);
}

/** Sync the routes table with `registeredRoutes` (see {@link runSync}). */
export function syncRoutes(
  routesModel: RoutesStore,
  registeredRoutes: RegisteredRoute[],
  stats: StatisticsSource = GetModel(RouteStatisticsModel),
): Promise<void> {
  const sync = runSync(routesModel, registeredRoutes, stats).finally(() => {
    if (pendingSync === sync) pendingSync = undefined;
  });
  pendingSync = sync;
  return sync;
}

/**
 * Sync the routes table again when the registered routes changed since the
 * last sync: a module reloaded in development, or registered after the
 * console started. The scope is read from that table on every request, so
 * this keeps a route that appeared or vanished from being in or out of scope
 * until the next restart. Concurrent callers share one sync.
 */
export async function ensureRoutesSynced(
  routesModel: RoutesStore,
): Promise<void> {
  if (pendingSync) return pendingSync;
  const registeredRoutes = getRegisteredRoutes();
  if (signatureOf(registeredRoutes) === syncedSignature) return;
  return syncRoutes(routesModel, registeredRoutes);
}
