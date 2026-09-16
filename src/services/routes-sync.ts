import type { getRegisteredRoutes } from "@antelopejs/interface-api";
import type { RouteModel } from "@/db";
import type { Route } from "@/db/tables/routes.table";
import type { HttpMethod } from "@/types";
import { getOwnModuleIds } from "./scope";

type RegisteredRoute = ReturnType<typeof getRegisteredRoutes>[number];

function normalizeMethod(method: string): HttpMethod {
  return method.toUpperCase() as HttpMethod;
}

function getRouteKey(method: string, uri: string): string {
  return `${normalizeMethod(method)}:${uri}`;
}

/**
 * Synchronize registered routes with the database
 * - Inserts new routes (with their owning module and own/module scope flag)
 * - Updates routes whose ownership info changed (or predates the module field)
 * - Deletes routes that no longer exist
 */
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
  existingRoutes: Route[],
  registeredByKey: Map<string, RegisteredRoute>,
): string[] {
  return existingRoutes
    .filter((r) => !registeredByKey.has(getRouteKey(r.method, r.uri)))
    .map((r) => r._id);
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
      uri: r.location,
      method: normalizeMethod(r.method),
      ...ownershipOf(r, ownModules),
      createdAt: now,
      updatedAt: now,
    }));
}

/** Existing rows whose ownership changed (covers rows predating the fields). */
function computeUpdates(
  existingRoutes: Route[],
  registeredByKey: Map<string, RegisteredRoute>,
  ownModules: ReadonlySet<string>,
): Route[] {
  const routesToUpdate: Route[] = [];
  for (const existing of existingRoutes) {
    const registered = registeredByKey.get(
      getRouteKey(existing.method, existing.uri),
    );
    if (!registered) continue;
    const { module, own } = ownershipOf(registered, ownModules);
    if (existing.module === module && existing.own === own) continue;
    existing.module = module;
    existing.own = own;
    routesToUpdate.push(existing);
  }
  return routesToUpdate;
}

export async function syncRoutes(
  routesModel: RouteModel,
  registeredRoutes: RegisteredRoute[],
): Promise<void> {
  const [existingRoutes, ownModules] = await Promise.all([
    routesModel.getAll(),
    getOwnModuleIds(),
  ]);
  const now = new Date();

  const existingByKey = new Map(
    existingRoutes.map((r) => [getRouteKey(r.method, r.uri), r]),
  );
  const registeredByKey = new Map(
    registeredRoutes.map((r) => [getRouteKey(r.method, r.location), r]),
  );

  const idsToDelete = computeDeletes(existingRoutes, registeredByKey);
  const routesToInsert = computeInserts(
    registeredByKey,
    existingByKey,
    ownModules,
    now,
  );
  const routesToUpdate = computeUpdates(
    existingRoutes,
    registeredByKey,
    ownModules,
  );

  await Promise.all([
    ...idsToDelete.map((id) => routesModel.delete(id)),
    ...routesToInsert.map((r) => routesModel.insert(r as Route)),
    ...routesToUpdate.map((r) => routesModel.update(r)),
  ]);
}
