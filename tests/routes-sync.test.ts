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
import type { Route } from "@/db/tables/routes.table";
import { routesStatisticsTableName } from "@/db/tables/routes_statistics.table";
import { ensureRoutesSynced, syncRoutes } from "@/services/routes-sync";
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

/** The routes the shop module registers, as the sync takes them. */
const SHOP_ROUTES = [
  { method: "get", location: "/api/orders/", module: "shop" },
  { method: "post", location: "/api/orders/", module: "shop" },
];

const DAY = 86_400_000;
const NOW = Date.now();

class FakeRoutes {
  rows = new Map<string, Route>();
  private next = 0;

  getAll() {
    return Promise.resolve(
      [...this.rows.values()].map((row) => structuredClone(row)),
    );
  }
  insert(route: Partial<Route>) {
    const _id = `r${this.next++}`;
    this.rows.set(
      _id,
      Object.assign(structuredClone(route), {
        _id,
        createdAt: new Date(NOW),
      }) as Route,
    );
    return Promise.resolve([_id]);
  }
  update(route: Partial<Route>) {
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

function stats(rows: Array<{ method: string; uri: string; days: number[] }>) {
  return {
    getAll: () =>
      Promise.resolve(
        rows.map((row) => ({
          ...row,
          statistics: row.days.map((day) => ({ day })),
        })),
      ),
  } as never;
}

let routes: FakeRoutes;
/** The fake, as the sync takes it. */
let store: Parameters<typeof syncRoutes>[0];

beforeEach(() => {
  routes = new FakeRoutes();
  store = routes as never;
});

describe("syncRoutes", () => {
  it("stores routes under their canonical path", async () => {
    await syncRoutes(store, SHOP_ROUTES as never, stats([]));
    expect(
      [...routes.rows.values()].map((r) => `${r.method} ${r.uri}`),
    ).toEqual(["GET /api/orders", "POST /api/orders"]);
  });

  it("dates a route from its first recorded call", async () => {
    const firstCall = NOW - 60 * DAY;
    await syncRoutes(
      store,
      SHOP_ROUTES as never,
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
