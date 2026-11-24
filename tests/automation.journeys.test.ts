import { describe, expect } from "vitest";
import type { z } from "zod";
import {
  HEALTH,
  INTERVAL_WAIT_MS,
  LOGS,
  TRIGGER_PATH,
  UNHEALTHY,
  WITH_NODES,
  apiNodes,
  arm,
  breakdownSchema,
  byName,
  emitted,
  attentionSchema,
  hasMore,
  healthSchema,
  lifetimeSchema,
  queryLogs,
  statusesOf,
  verdictSchema,
} from "./helpers/automation";
import { type Dms, FIXTURE_ROUTES, test } from "./helpers/dms";
import { seedLogs, seedStatistics } from "./helpers/seed";

async function assertWithoutTheAutomationModuleTheRegistrationIsASilentNoOp(
  dms: Dms,
): Promise<void> {
  await dms.backend.stop();
  const from = dms.backend.logSize();
  await dms.backend.start();
  await dms.traffic([{ path: "/fx/ok", count: 1 }]);
  const lines = dms.backend.logSince(from).split("\n");
  const health = await dms.mon("/overview/health");
  const settings = await dms.mon("/settings");
  expect
    .soft(
      lines.some((line) =>
        /Optional interface '@antelopejs\/interface-dms-automation' has no provider/.test(
          line,
        ),
      ),
      "the log says the optional automation interface has no provider",
    )
    .toBe(true);
  expect
    .soft(
      lines.filter(
        (line) =>
          /\[ERROR\]/.test(line) &&
          /automation|api\.route-unhealthy|api\.get-api-health|api\.query-request-logs/i.test(
            line,
          ),
      ),
      "no error line names the automation nodes",
    )
    .toEqual([]);
  expect
    .soft(
      lines.filter(
        (line) =>
          /dms-api/.test(line) &&
          /(failed|did not construct|Failed to)/i.test(line),
      ),
      "no line says dms-api failed",
    )
    .toEqual([]);
  expect
    .soft(
      [
        health.status,
        settings.status,
        lifetimeSchema.parse(settings.body).statisticsLifetimeDays,
      ],
      "the console answers",
    )
    .toEqual([200, 200, 90]);
  expect
    .soft(verdictSchema.parse(health.body).verdict, "the health reads the call")
    .not.toBe("");
}

async function assertTheModuleRegistersItsNodesWithTheirDocumentedInputs(
  dms: Dms,
): Promise<void> {
  await dms.withEnv(WITH_NODES, async () => {
    const { actions, triggers } = apiNodes(
      (await dms.api("GET", "/dms/fixture-api/nodes", { as: "anon" })).body,
    );
    const health = actions.find((node) => node.id === HEALTH);
    const logs = actions.find((node) => node.id === LOGS);
    const unhealthy = triggers.find((node) => node.id === UNHEALTHY);
    const input = (node: typeof health, name: string) =>
      node?.inputSchema?.get(name);
    const config = (node: typeof health, name: string) =>
      node?.configSchema?.get(name);
    expect
      .soft(actions.map((node) => node.id).toSorted(byName), "actions")
      .toEqual(
        [
          LOGS,
          HEALTH,
          "api.call-route",
          "api.list-unhealthy-routes",
          "api.list-incidents",
          "api.get-route-statistics",
          "api.get-route-errors",
          "api.get-request-log",
          "api.get-route-detail",
          "api.list-routes",
        ].toSorted(byName),
      );
    expect
      .soft(
        triggers.map((node) => node.id),
        "triggers",
      )
      .toEqual([
        UNHEALTHY,
        "api.health-changed",
        "api.route-recovered",
        "api.request-captured",
        "api.route-registered",
      ]);
    expect
      .soft(unhealthy?.cluster, "the trigger runs on one node of a cluster")
      .toBe("singleton");
    expect
      .soft(input(health, "days"), "days")
      .toMatchObject({ type: "integer", minimum: 1, maximum: 90 });
    expect
      .soft(input(logs, "limit"), "limit")
      .toMatchObject({ default: 50, maximum: 200 });
    expect
      .soft(input(logs, "statusClass")?.enum, "statusClass")
      .toEqual(["success", "client-error", "server-error"]);
    expect
      .soft(
        ["routeId", "uri", "method", "statusMin", "statusMax"].map(
          (name) => input(logs, name)?.type,
        ),
        "the other filters",
      )
      .toEqual(["string", "string", "string", "integer", "integer"]);
    expect
      .soft(config(unhealthy, "intervalSeconds"), "intervalSeconds")
      .toMatchObject({ default: 60, minimum: 10 });
    expect.soft(config(unhealthy, "flags"), "flags").toMatchObject({
      items: { enum: ["broken", "slow", "warn"] },
      default: ["broken", "slow"],
    });
    expect
      .soft([...(unhealthy?.outputSchema.keys() ?? [])], "the trigger's output")
      .toEqual([
        "deliveryId",
        "routeKey",
        "method",
        "uri",
        "flag",
        "errorRate",
        "averageLatencyMs",
        "requestsLast24h",
      ]);
    expect
      .soft(
        [...(health?.outputSchema.keys() ?? [])],
        "the health action's output",
      )
      .toEqual([
        "totalRoutes",
        "failingRoutes",
        "slowRoutesCount",
        "averageLatencyMs",
        "callsToday",
        "errors24h",
        "statusBreakdown",
        "verdict",
        "verdictSince",
        "incidentStart",
        "incidentEnd",
        "durationMs",
        "serverErrorRate",
        "clientErrorRate",
        "p95Ms",
        "requestsPerMinute",
        "calls24h",
        "serverErrors24h",
        "recoveredRoutes",
        "routesNeedingAttention",
        "scope",
        "logsPath",
        "checkedAt",
      ]);
  });
}

async function assertGetApiHealthRestrictsItsBreakdownToTheLastDays(
  dms: Dms,
): Promise<void> {
  await seedStatistics(dms, {
    method: "GET",
    uri: "/fx/ok",
    daysAgo: 10,
    requests: 4,
    serverErrors: 1,
  });
  await seedStatistics(dms, {
    method: "GET",
    uri: "/fx/ok",
    daysAgo: 0,
    requests: 6,
  });
  await dms.withEnv(WITH_NODES, async () => {
    const health = async (input: { days?: number }) =>
      healthSchema.parse((await dms.runAction(HEALTH, input)).body);
    const everything = await health({});
    const one = await health({ days: 1 });
    const five = await health({ days: 5 });
    const thirty = await health({ days: 30 });
    const figures = (breakdown: z.infer<typeof breakdownSchema>) => [
      breakdown.total,
      breakdown.serverErrors,
      breakdown.clientErrors,
      breakdown.success,
    ];
    expect
      .soft(
        figures(everything.statusBreakdown),
        "without days: every retained day",
      )
      .toEqual([10, 1, 0, 9]);
    expect
      .soft(figures(one.statusBreakdown), "the last day")
      .toEqual([6, 0, 0, 6]);
    expect
      .soft(figures(five.statusBreakdown), "the last 5 days")
      .toEqual([6, 0, 0, 6]);
    expect
      .soft(figures(thirty.statusBreakdown), "the last 30 days")
      .toEqual([10, 1, 0, 9]);
    expect
      .soft(
        everything.totalRoutes,
        "totalRoutes counts the routes of the scope",
      )
      .toBe(FIXTURE_ROUTES);
    expect
      .soft([one.callsToday, one.totalRoutes], "the KPIs do not follow days")
      .toEqual([everything.callsToday, everything.totalRoutes]);
    expect.soft(everything.callsToday, "callsToday").toBe(6);
    expect
      .soft(
        [everything.failingRoutes, everything.errors24h],
        "no route is failing",
      )
      .toEqual([0, 0]);
  });
}

async function assertQueryRequestLogsPagesCapsAndFilters(
  dms: Dms,
): Promise<void> {
  await seedLogs(dms, { minutesAgo: 100, count: 250, uri: "/fx/ok" });
  await seedLogs(dms, {
    minutesAgo: 50,
    count: 20,
    uri: "/fx/missing",
    statusCode: 404,
    message: "seeded gone",
  });
  await seedLogs(dms, {
    minutesAgo: 20,
    count: 3,
    uri: "/fx/boom",
    statusCode: 500,
    message: "seeded boom",
  });
  await dms.withEnv(WITH_NODES, async () => {
    const defaults = await queryLogs(dms, {});
    const capped = await queryLogs(dms, { limit: 250 });
    const ten = await queryLogs(dms, { limit: 10 });
    const client = await queryLogs(dms, {
      statusClass: "client-error",
      limit: 200,
    });
    const server = await queryLogs(dms, { statusClass: "server-error" });
    const success = await queryLogs(dms, { statusClass: "success" });
    const range = await queryLogs(dms, { statusMin: 500, statusMax: 599 });
    const exact = await queryLogs(dms, {
      statusMin: 404,
      statusMax: 404,
      limit: 200,
    });
    const byUri = await queryLogs(dms, { uri: "/fx/missing", limit: 200 });
    const byMethod = await queryLogs(dms, { method: "POST" });
    expect
      .soft(
        [defaults.results.length, hasMore(defaults)],
        "the default is 50 rows and more remain",
      )
      .toEqual([50, true]);
    expect
      .soft(
        [capped.results.length, hasMore(capped)],
        "a limit of 250 is capped to 200 and more remain",
      )
      .toEqual([200, true]);
    expect
      .soft([ten.results.length, hasMore(ten)], "a limit of 10")
      .toEqual([10, true]);
    expect
      .soft(
        [client.results.length, statusesOf(client), client.nextCursor ?? ""],
        "client errors only",
      )
      .toEqual([20, [404], ""]);
    expect
      .soft([server.results.length, statusesOf(server)], "server errors only")
      .toEqual([3, [500]]);
    expect
      .soft([success.results.length, statusesOf(success)], "success only")
      .toEqual([50, [200]]);
    expect
      .soft([range.results.length, statusesOf(range)], "a status range")
      .toEqual([3, [500]]);
    expect
      .soft([exact.results.length, statusesOf(exact)], "a range of one status")
      .toEqual([20, [404]]);
    expect
      .soft(
        [
          byUri.results.length,
          [...new Set(byUri.results.map((row) => row.uri))],
        ],
        "a uri",
      )
      .toEqual([20, ["/fx/missing"]]);
    expect.soft(byMethod.results.length, "a method with none of it").toBe(0);
    expect
      .soft(
        Number.isNaN(Date.parse(defaults.results[0]?.timestamp ?? "")),
        "each row carries an ISO timestamp",
      )
      .toBe(false);
  });
}

async function assertRouteUnhealthyFiresOnTheFlagsItWatchesAndNeverFasterThanTenSeconds(
  dms: Dms,
): Promise<void> {
  await dms.saveSettings({ requestSlownessThresholdMs: 50 });
  await dms.withEnv(WITH_NODES, async () => {
    const watching = {
      broken: await arm(dms, { intervalSeconds: 10, flags: ["broken"] }),
      warn: await arm(dms, { intervalSeconds: 10, flags: ["warn"] }),
      defaults: await arm(dms, { intervalSeconds: 10 }),
      quick: await arm(dms, {
        intervalSeconds: 1,
        flags: ["broken", "slow", "warn"],
      }),
    };
    await dms.traffic([
      { path: "/fx/boom", count: 25 },
      { path: "/fx/missing", count: 25 },
      { path: "/fx/slow?ms=80", count: 20 },
    ]);
    await dms.settled("/overview/attention", (body) => {
      const attention = attentionSchema.safeParse(body);
      return attention.success && attention.data.items.length >= 3;
    });
    const early = await emitted(dms, watching.quick);
    await new Promise((done) => setTimeout(done, INTERVAL_WAIT_MS));
    const results = {
      broken: await emitted(dms, watching.broken),
      warn: await emitted(dms, watching.warn),
      defaults: await emitted(dms, watching.defaults),
      quick: await emitted(dms, watching.quick),
    };
    expect
      .soft(results.broken.flags, "broken only")
      .toEqual(["/fx/boom:broken"]);
    expect.soft(results.warn.flags, "warn only").toEqual(["/fx/missing:warn"]);
    expect
      .soft(results.defaults.flags, "the default flags are broken and slow")
      .toEqual(["/fx/boom:broken", "/fx/slow:slow"]);
    expect
      .soft(results.quick.flags, "all three flags")
      .toEqual(["/fx/boom:broken", "/fx/missing:warn", "/fx/slow:slow"]);
    expect
      .soft(results.broken.rows[0], "the output of a broken route")
      .toMatchObject({
        routeKey: "GET:/fx/boom",
        method: "GET",
        uri: "/fx/boom",
        flag: "broken",
        requestsLast24h: 25,
      });
    expect
      .soft(
        results.broken.rows[0]?.errorRate,
        "the error rate of a route failing every call, as a ratio",
      )
      .toBe(1);
    expect
      .soft(
        early.rows.length,
        "an interval of 1 second fires nothing before 10 seconds",
      )
      .toBe(0);
    expect.soft(results.quick.rows.length, "and fires after them").toBe(3);
    for (const key of Object.values(watching))
      await dms.api("POST", `${TRIGGER_PATH}/${UNHEALTHY}/deactivate/${key}`, {
        as: "anon",
      });
  });
}

async function assertQueryRequestLogsNextCursorReadsTheNextPage(
  dms: Dms,
): Promise<void> {
  await seedLogs(dms, { minutesAgo: 100, count: 30, uri: "/fx/ok" });
  await dms.withEnv(WITH_NODES, async () => {
    const first = await queryLogs(dms, { limit: 10 });
    const cursor = first.nextCursor ?? "";
    const second = await queryLogs(dms, { limit: 10, cursor });
    const firstIds = first.results.map((row) => row.id);
    const secondIds = second.results.map((row) => row.id);
    expect
      .soft(cursor !== "", "a cursor comes back while rows remain")
      .toBe(true);
    expect
      .soft(
        secondIds.length === 10 &&
          secondIds.every((id) => !firstIds.includes(id)),
        "the cursor of page 1 reads page 2, without overlap",
      )
      .toBe(true);
  });
}

async function assertQueryRequestLogsReadsSinceInclusiveAndUntilExclusive(
  dms: Dms,
): Promise<void> {
  await seedLogs(dms, { minutesAgo: 100, count: 5, uri: "/fx/ok" });
  await dms.withEnv(WITH_NODES, async () => {
    const all = await queryLogs(dms, { limit: 10 });
    const times = all.results.map((row) => row.timestamp);
    const window = await queryLogs(dms, {
      since: times[3] ?? "",
      until: times[1] ?? "",
    });
    expect
      .soft(
        window.results.map((row) => row.timestamp),
        "since is kept, until is not",
      )
      .toEqual([times[2], times[3]]);
  });
}

describe("automation", () => {
  test("without-the-automation-module-the-registration-is-a-silent-no-op", ({
    dms,
  }) => assertWithoutTheAutomationModuleTheRegistrationIsASilentNoOp(dms));
  test("the-module-registers-its-nodes-with-their-documented-inputs", ({
    dms,
  }) => assertTheModuleRegistersItsNodesWithTheirDocumentedInputs(dms));
  test("get-api-health-restricts-its-breakdown-to-the-last-days", ({ dms }) =>
    assertGetApiHealthRestrictsItsBreakdownToTheLastDays(dms));
  test("query-request-logs-pages-caps-and-filters", ({ dms }) =>
    assertQueryRequestLogsPagesCapsAndFilters(dms));
  test("route-unhealthy-fires-on-the-flags-it-watches-and-never-faster-than-ten-seconds", ({
    dms,
  }) =>
    assertRouteUnhealthyFiresOnTheFlagsItWatchesAndNeverFasterThanTenSeconds(
      dms,
    ));
  test("query-request-logs-reads-since-inclusive-and-until-exclusive", ({
    dms,
  }) => assertQueryRequestLogsReadsSinceInclusiveAndUntilExclusive(dms));
  test("query-request-logs-next-cursor-reads-the-next-page", ({ dms }) =>
    assertQueryRequestLogsNextCursorReadsTheNextPage(dms));
});
