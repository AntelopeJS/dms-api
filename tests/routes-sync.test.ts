import { getRegisteredRoutes } from "@antelopejs/interface-api";
import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModuleInfo,
  ListModules,
  type ModuleInfo,
} from "@antelopejs/interface-core/modules";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DeepPartial } from "@antelopejs/interface-database-decorators";
import type { Route } from "@/db/tables/routes.table";
import {
  getRouteStatsKey,
  routesStatisticsTableName,
} from "@/db/tables/routes_statistics.table";
import {
  ensureRoutesSynced,
  type RoutesStore,
  type StatisticsSource,
  syncRoutes,
} from "@/services/routes-sync";
import { isString } from "@/guards";
import { emptyHistogram } from "@/services/statistics-utils";
import type { DayStatistics } from "@/types";
import { serveTable } from "./helpers/database";
import {
  registerRoutes,
  routeHandler,
  unregisterRoutes,
} from "./helpers/routes";

/** The shop module, loaded from the project itself. */
const SHOP_MODULE: ModuleInfo = {
  source: { type: "local" },
  config: {},
  importOverrides: {},
  disabledExports: [],
  status: "active",
  localPath: "/shop",
};

ImplementInterface(
  { ListModules, GetModuleInfo },
  {
    ListModules: () => Promise.resolve(["shop"]),
    GetModuleInfo: () => Promise.resolve(SHOP_MODULE),
  },
);

beforeAll(() => serveTable(routesStatisticsTableName, []));

afterEach(unregisterRoutes);

/** A route of the shop module, as `getRegisteredRoutes` lists it. */
function shopRoute(
  id: string,
  method: string,
  location: string,
): ReturnType<typeof getRegisteredRoutes>[number] {
  return {
    id,
    method,
    location,
    callbackName: "handle",
    parameters: [],
    properties: {},
    module: "shop",
  };
}

/** The routes the shop module registers, as the sync takes them. */
const SHOP_ROUTES = [
  shopRoute("0", "get", "/api/orders/"),
  shopRoute("1", "post", "/api/orders/"),
];

const DAY = 86_400_000;
const NOW = Date.now();

class FakeRoutes implements RoutesStore {
  rows = new Map<string, Route>();
  private next = 0;

  getAll() {
    return Promise.resolve(
      [...this.rows.values()].map((row) => structuredClone(row)),
    );
  }
  insert(route: Partial<Route>) {
    const { uri, method, module, own, updatedAt } = route;
    if (
      uri === undefined ||
      method === undefined ||
      module === undefined ||
      own === undefined ||
      updatedAt === undefined
    ) {
      throw new Error("The sync inserts complete routes.");
    }
    const _id = `r${this.next++}`;
    this.rows.set(_id, {
      _id,
      uri,
      method,
      module,
      own,
      createdAt: new Date(NOW),
      updatedAt: new Date(updatedAt),
    });
    return Promise.resolve([_id]);
  }
  update(route: string | DeepPartial<Route>) {
    if (isString(route))
      throw new Error("The sync updates a route by its row.");
    const row = route._id ? this.rows.get(route._id) : undefined;
    if (row)
      Object.assign(row, {
        module: route.module,
        own: route.own,
        uri: route.uri,
      });
    return Promise.resolve(1);
  }
  delete(id: string) {
    this.rows.delete(id);
    return Promise.resolve(1);
  }
  setCreatedAt(id: string, createdAt: Date) {
    const row = this.rows.get(id);
    if (row) row.createdAt = createdAt;
    return Promise.resolve();
  }
}

/** A day of one call, all that the sync reads being its `day`. */
function oneCall(day: number): DayStatistics {
  return {
    day,
    requestsCount: 1,
    averageResponseTime: 10,
    minResponseTime: 10,
    maxResponseTime: 10,
    totalResponseTime: 10,
    clientErrorsCount: 0,
    serverErrorsCount: 0,
    timedRequestsCount: 1,
    latencyHistogram: emptyHistogram(),
  };
}

function stats(
  rows: Array<{ method: string; uri: string; days: number[] }>,
): StatisticsSource {
  return {
    getAll: () =>
      Promise.resolve(
        rows.map((row) => ({
          _id: getRouteStatsKey(row.method, row.uri),
          method: row.method,
          uri: row.uri,
          statistics: row.days.map(oneCall),
          revision: "r1",
        })),
      ),
  };
}

let routes: FakeRoutes;
/** The fake, as the sync takes it. */
let store: RoutesStore;

beforeEach(() => {
  routes = new FakeRoutes();
  store = routes;
});

describe("syncRoutes", () => {
  it("stores routes under their canonical path", async () => {
    await syncRoutes(store, SHOP_ROUTES, stats([]));
    expect(
      [...routes.rows.values()].map((r) => `${r.method} ${r.uri}`),
    ).toEqual(["GET /api/orders", "POST /api/orders"]);
  });

  it("dates a route from its first recorded call", async () => {
    const firstCall = NOW - 60 * DAY;
    await syncRoutes(
      store,
      SHOP_ROUTES,
      stats([
        { method: "GET", uri: "/api/orders/", days: [NOW - DAY, firstCall] },
      ]),
    );
    const get = [...routes.rows.values()].find((r) => r.method === "GET");
    const post = [...routes.rows.values()].find((r) => r.method === "POST");
    expect(get?.createdAt.getTime()).toBe(firstCall);
    expect(post?.createdAt.getTime()).toBe(NOW);
  });
});

describe("ensureRoutesSynced", () => {
  it("syncs again only when the registered routes changed", async () => {
    registerRoutes(
      routeHandler("get", "/api/orders/"),
      routeHandler("post", "/api/orders/"),
    );
    await syncRoutes(store, getRegisteredRoutes(), stats([]));
    const getAll = vi.spyOn(routes, "getAll");
    await ensureRoutesSynced(store);
    expect(getAll).not.toHaveBeenCalled();

    registerRoutes(routeHandler("get", "/api/customers"));
    await ensureRoutesSynced(store);
    expect([...routes.rows.values()].map((r) => r.uri)).toContain(
      "/api/customers",
    );
  });
});
