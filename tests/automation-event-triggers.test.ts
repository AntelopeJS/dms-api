import { ImplementInterface } from "@antelopejs/interface-core";
import {
  GetModuleInfo,
  ListModules,
  type ModuleInfo,
} from "@antelopejs/interface-core/modules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureFilter,
  minuteCap,
  requestCapturedTriggerOf,
} from "@/automation/request-captured";
import {
  routeChangesFor,
  routeRegisteredTriggerOf,
} from "@/automation/route-registered";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";
import { RouteWatch as StoredWatch } from "@/db/tables/route_watch.table";
import { notifyCaptured } from "@/services/request-log/captured";
import {
  createRouteWatch,
  pollRouteWatch,
  type RouteChange,
  type RouteWatchDiff,
  type RouteWatchStore,
} from "@/services/route-watch";
import {
  registerRoutes,
  routeHandler,
  unregisterRoutes,
} from "./helpers/routes";
import { recorder, sequence } from "./helpers/triggers";

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

const NOW = new Date("2026-11-20T10:00:30.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  unregisterRoutes();
});

function settle(ms = 0): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
}

function captured(
  fields: Partial<RequestLogSummaryRow> = {},
): RequestLogSummaryRow {
  return {
    _id: "log-1",
    timestamp: NOW,
    method: "POST",
    uri: "/api/orders",
    statusCode: 500,
    responseTimeMs: 120,
    routeId: "3",
    errorMessage: "boom",
    ...fields,
  };
}

describe("the filter of api.request-captured", () => {
  const all = () => null;

  it("never fires on a procedure's own calls or on the automation API", () => {
    const matches = captureFilter(
      { statusClasses: ["success", "client-error", "server-error"] },
      all,
    );
    expect(matches(captured({ source: "automation" }))).toBe(false);
    expect(matches(captured({ uri: "/api/automation/runs/:id" }))).toBe(false);
    expect(matches(captured({ uri: "/api/automations" }))).toBe(true);
  });

  it("takes 5xx only by default, and each configured filter excludes", () => {
    expect(captureFilter({}, all)(captured({ statusCode: 404 }))).toBe(false);
    const cases: Array<
      [Parameters<typeof captureFilter>[0], Partial<RequestLogSummaryRow>]
    > = [
      [{ statusMin: 502 }, {}],
      [{ statusMax: 499 }, {}],
      [{ methods: ["GET"] }, {}],
      [{ routes: ["POST /api/users"] }, {}],
      [{ pathPrefix: "/api/users" }, {}],
      [{ minResponseTimeMs: 500 }, {}],
      [{}, { routeId: undefined }],
      [{}, { source: "tester" }],
    ];
    for (const [config, row] of cases) {
      expect(
        captureFilter(config, all)(captured(row)),
        JSON.stringify([config, row]),
      ).toBe(false);
    }
    expect(
      captureFilter(
        {
          routes: ["post /api/orders/"],
          pathPrefix: "/api",
          includeTester: true,
        },
        all,
      )(captured({ source: "tester" })),
    ).toBe(true);
  });

  it("keeps to the active scope's routes, and fires on nothing while the scope is unknown", () => {
    const inScope = captureFilter({}, () => new Set(["POST:/api/orders"]));
    expect(inScope(captured())).toBe(true);
    expect(inScope(captured({ uri: "/api/users" }))).toBe(false);
    expect(captureFilter({}, () => undefined)(captured())).toBe(false);
    expect(captureFilter({ scope: "all" }, () => undefined)(captured())).toBe(
      true,
    );
  });
});

describe("minuteCap", () => {
  it("drops the matches over the cap and hands their count to the next emission", () => {
    let now = NOW.getTime();
    const cap = minuteCap(2, () => now);
    expect([cap.take(), cap.take(), cap.take(), cap.take()]).toEqual([
      0,
      0,
      null,
      null,
    ]);
    now += 60_000;
    expect([cap.take(), cap.take()]).toEqual([2, 0]);
  });
});

type CaptureEmission = Parameters<
  Parameters<ReturnType<typeof requestCapturedTriggerOf>["activate"]>[1]
>[0];

describe("api.request-captured", () => {
  const orders = () => Promise.resolve(new Set(["POST:/api/orders"]));

  it("emits each matching stored request once, with its log id, until deactivated", async () => {
    const trigger = requestCapturedTriggerOf(orders);
    const { emitted, emit } = recorder<CaptureEmission>();
    const handle = await trigger.activate({ maxPerMinute: 1 }, emit);
    notifyCaptured(() => captured());
    notifyCaptured(() => captured({ _id: "log-2" }));
    vi.setSystemTime(NOW.getTime() + 60_000);
    notifyCaptured(() => captured({ _id: "log-3", statusCode: 200 }));
    notifyCaptured(() => captured({ _id: "log-4" }));
    await trigger.deactivate(handle);
    notifyCaptured(() => captured({ _id: "log-5" }));
    expect(
      emitted.map((payload) => [payload.deliveryId, payload.droppedBefore]),
    ).toEqual([
      ["log-1", 0],
      ["log-4", 1],
    ]);
    expect(emitted[0]).toMatchObject({
      id: "log-1",
      route: "POST /api/orders",
      consolePath: "/modules/api/logs?record=log-1",
    });
  });

  it("builds no summary while no activation listens", () => {
    let built = 0;
    notifyCaptured(() => {
      built += 1;
      return captured();
    });
    expect(built).toBe(0);
  });

  it("keeps a capture going when a listener throws", async () => {
    const trigger = requestCapturedTriggerOf(orders);
    const throwing = await trigger.activate({}, () => {
      throw new Error("listener broke");
    });
    const { emitted, emit } = recorder<CaptureEmission>();
    const handle = await trigger.activate({}, emit);
    expect(() => notifyCaptured(() => captured())).not.toThrow();
    await trigger.deactivate(throwing);
    await trigger.deactivate(handle);
    expect(emitted).toHaveLength(1);
  });

  it("follows the scope as it is read again every minute", async () => {
    const scope = sequence(new Set<string>(), new Set(["POST:/api/orders"]));
    const trigger = requestCapturedTriggerOf(scope.read);
    const { emitted, emit } = recorder<CaptureEmission>();
    const handle = await trigger.activate({}, emit);
    notifyCaptured(() => captured());
    await settle(60_000);
    notifyCaptured(() => captured({ _id: "log-2" }));
    await trigger.deactivate(handle);
    expect(emitted.map((payload) => payload.id)).toEqual(["log-2"]);
  });
});

function change(route: string, own: boolean | null): RouteChange {
  const [method, path] = route.split(" ");
  return {
    route,
    method,
    path,
    module: own ? "shop" : "billing",
    own,
    controller: null,
    routePath: "",
  };
}

const DIFF: RouteWatchDiff = {
  deliveryId: "api.route-registered:a:b",
  registered: [
    change("GET /api/orders", true),
    change("GET /billing/invoices", false),
  ],
  removed: [change("DELETE /api/orders/:id", true)],
  checkedAt: NOW,
};

describe("routeChangesFor", () => {
  it("lists both changes by default", () => {
    expect(routeChangesFor({}, DIFF)).toMatchObject({
      registeredCount: 2,
      removedCount: 1,
      truncated: false,
      checkedAt: NOW.toISOString(),
    });
  });

  it("filters by change, ownership and path, and emits nothing when nothing is left", () => {
    expect(routeChangesFor({ changes: ["removed"] }, DIFF)?.registered).toEqual(
      [],
    );
    expect(
      routeChangesFor({ scope: "own" }, DIFF)?.registered.map(
        (entry) => entry.route,
      ),
    ).toEqual(["GET /api/orders"]);
    expect(
      routeChangesFor({ scope: "modules", changes: ["removed"] }, DIFF),
    ).toBeNull();
    expect(
      routeChangesFor({ pathPrefix: "/billing" }, DIFF)?.registered.map(
        (entry) => entry.route,
      ),
    ).toEqual(["GET /billing/invoices"]);
  });

  it("cuts each list at 200, counting before the cut", () => {
    const many = Array.from({ length: 250 }, (_, index) =>
      change(`GET /api/r${index}`, true),
    );
    const output = routeChangesFor({}, { ...DIFF, registered: many });
    expect(output?.registered).toHaveLength(200);
    expect(output?.registeredCount).toBe(250);
    expect(output?.truncated).toBe(true);
  });
});

/** The route watch document kept in memory, compare-and-set like the model. */
class MemoryWatchStore implements RouteWatchStore {
  doc: StoredWatch | undefined;
  writes = 0;
  reads = 0;

  current() {
    this.reads += 1;
    return Promise.resolve(this.doc && structuredClone(this.doc));
  }

  create(routes: StoredWatch["routes"], revision: string) {
    if (this.doc) return Promise.resolve(false);
    this.writes += 1;
    this.doc = this.row(routes, revision);
    return Promise.resolve(true);
  }

  replace(expected: string, routes: StoredWatch["routes"], revision: string) {
    if (this.doc?.revision !== expected) return Promise.resolve(false);
    this.writes += 1;
    this.doc = this.row(routes, revision);
    return Promise.resolve(true);
  }

  private row(routes: StoredWatch["routes"], revision: string): StoredWatch {
    return Object.assign(new StoredWatch(), {
      _id: "registered",
      routes,
      revision,
      updatedAt: new Date(),
    });
  }
}

describe("pollRouteWatch", () => {
  it("stores the first set silently, then reports what a restart added and removed", async () => {
    const store = new MemoryWatchStore();
    registerRoutes(
      routeHandler("get", "/api/orders"),
      routeHandler("delete", "/api/orders/:id"),
    );
    expect(await pollRouteWatch(store, NOW)).toBeNull();
    expect(await pollRouteWatch(store, NOW)).toBeNull();
    expect(store.writes).toBe(1);

    unregisterRoutes();
    registerRoutes(
      routeHandler("get", "/api/orders"),
      routeHandler("get", "/billing/invoices"),
    );
    const diff = await pollRouteWatch(store, NOW);
    expect(diff?.registered).toMatchObject([
      {
        route: "GET /billing/invoices",
        method: "GET",
        path: "/billing/invoices",
        module: null,
        own: false,
        routePath: "/modules/api/routes?route=GET+%2Fbilling%2Finvoices",
      },
    ]);
    expect(diff?.removed).toEqual([
      {
        route: "DELETE /api/orders/:id",
        method: "DELETE",
        path: "/api/orders/:id",
        module: null,
        own: false,
        controller: null,
        routePath: "/modules/api/routes?route=DELETE+%2Fapi%2Forders%2F%3Aid",
      },
    ]);
    expect(diff?.deliveryId).toMatch(
      /^api\.route-registered:[0-9a-f]{16}:[0-9a-f]{16}$/,
    );
  });

  it("reports a change once when two instances see it: the second write loses", async () => {
    const store = new MemoryWatchStore();
    registerRoutes(routeHandler("get", "/api/orders"));
    await pollRouteWatch(store, NOW);
    registerRoutes(routeHandler("post", "/api/orders"));
    const stale = await store.current();
    const late: RouteWatchStore = {
      current: () => Promise.resolve(stale),
      create: (routes, revision) => store.create(routes, revision),
      replace: (expected, routes, revision) =>
        store.replace(expected, routes, revision),
    };
    expect(await pollRouteWatch(store, NOW)).not.toBeNull();
    expect(await pollRouteWatch(late, NOW)).toBeNull();
  });
});

type RoutesEmission = Parameters<
  Parameters<ReturnType<typeof routeRegisteredTriggerOf>["activate"]>[1]
>[0];

describe("api.route-registered", () => {
  it("polls once for every activation, writes once, and stops with the last one", async () => {
    const store = new MemoryWatchStore();
    const watch = createRouteWatch(() => store);
    const trigger = routeRegisteredTriggerOf(watch);
    registerRoutes(routeHandler("get", "/api/orders"));
    const first = recorder<RoutesEmission>();
    const second = recorder<RoutesEmission>();
    const one = await trigger.activate({ intervalSeconds: 60 }, first.emit);
    const two = await trigger.activate(
      { intervalSeconds: 10, changes: ["removed"] },
      second.emit,
    );
    await settle();
    registerRoutes(routeHandler("post", "/api/orders"));
    await settle(10_000);
    expect(store.writes).toBe(2);
    expect(first.emitted.map((payload) => payload.registeredCount)).toEqual([
      1,
    ]);
    expect(second.emitted).toEqual([]);
    await trigger.deactivate(one);
    await trigger.deactivate(two);
    const reads = store.reads;
    await settle(120_000);
    expect(store.reads).toBe(reads);
  });
});
