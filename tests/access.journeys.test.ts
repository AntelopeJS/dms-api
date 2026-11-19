import { describe, expect } from "vitest";
import { z } from "zod";
import { type Dms, test } from "./helpers/dms";

const ROUTES: [string, string][] = [
  ["GET", "/overview/health"],
  ["GET", "/overview/traffic"],
  ["GET", "/overview/classes"],
  ["GET", "/overview/error-share"],
  ["GET", "/overview/attention"],
  ["GET", "/overview/slowest"],
  ["GET", "/overview/activity"],
  ["GET", "/logs"],
  ["GET", "/logs/recent"],
  ["GET", "/logs/routes?route=GET%20%2Ffx%2Fok"],
  ["GET", "/logs/tester?requestId=x"],
  ["GET", "/logs/live"],
  ["GET", "/logs/missing"],
  ["GET", "/logs/recent/missing"],
  ["GET", "/logs/tester/missing"],
  ["GET", "/logs/routes/missing"],
  ["GET", "/routes/list"],
  ["GET", "/routes/detail?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/activity?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/summary?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/status?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/latency-chart?route=GET%20%2Ffx%2Fok"],
  ["GET", "/routes/statistics/errors?route=GET%20%2Ffx%2Fok"],
  ["GET", "/settings"],
  ["POST", "/settings"],
  ["GET", "/settings/retention-impact?field=requestLogRetentionDays&days=30"],
  ["GET", "/settings/summary"],
  ["GET", "/tester/source"],
];

const BLOCK_OF = new Map([
  ["GET /overview/health", "modules.api.monitor.overview.health"],
  [
    "GET /overview/traffic",
    "modules.api.monitor.overview.dashboard.traffic.chart",
  ],
  [
    "GET /overview/classes",
    "modules.api.monitor.overview.dashboard.traffic.classes",
  ],
  [
    "GET /overview/error-share",
    "modules.api.monitor.overview.dashboard.health.errorShare",
  ],
  [
    "GET /overview/attention",
    "modules.api.monitor.overview.dashboard.health.attention",
  ],
  [
    "GET /overview/slowest",
    "modules.api.monitor.overview.dashboard.health.slowest",
  ],
  [
    "GET /overview/activity",
    "modules.api.monitor.overview.dashboard.recent.activity",
  ],
  ["GET /logs", "modules.api.monitor.logs.requests"],
  [
    "GET /logs/recent",
    "modules.api.monitor.overview.dashboard.recent.requests.table",
  ],
  [
    "GET /logs/routes",
    "modules.api.explore.routes.explorer.tabs.statistics.recent.requests.table",
  ],
  ["GET /logs/tester", "modules.api.explore.routes.explorer.tabs.tester"],
  ["GET /logs/live", "modules.api.monitor.logs.live"],
  ["GET /logs/missing", "modules.api.monitor.logs.requests"],
  [
    "GET /logs/recent/missing",
    "modules.api.monitor.overview.dashboard.recent.requests.table",
  ],
  [
    "GET /logs/tester/missing",
    "modules.api.explore.routes.explorer.tabs.tester",
  ],
  [
    "GET /logs/routes/missing",
    "modules.api.explore.routes.explorer.tabs.statistics.recent.requests.table",
  ],
  ["GET /routes/list", "modules.api.explore.routes.explorer.tree"],
  ["GET /routes/detail", "modules.api.explore.routes.explorer"],
  [
    "GET /routes/statistics/activity",
    "modules.api.explore.routes.explorer.tabs.statistics",
  ],
  [
    "GET /routes/statistics/summary",
    "modules.api.explore.routes.explorer.tabs.statistics.grid.summary.summary",
  ],
  [
    "GET /routes/statistics/status",
    "modules.api.explore.routes.explorer.tabs.statistics.grid.charts.status",
  ],
  [
    "GET /routes/statistics/latency-chart",
    "modules.api.explore.routes.explorer.tabs.statistics.grid.charts.latency",
  ],
  [
    "GET /routes/statistics/errors",
    "modules.api.explore.routes.explorer.tabs.statistics.grid.detail.errors",
  ],
  ["GET /settings", "modules.api.configure.settings.form"],
  ["POST /settings", "modules.api.configure.settings.form"],
  ["GET /settings/retention-impact", "modules.api.configure.settings.form"],
  ["GET /tester/source", "modules.api.explore.routes.explorer.tabs.tester"],
]);

const refusalSchema = z
  .union([
    z.string(),
    z
      .object({ message: z.string().optional(), error: z.string().optional() })
      .transform((body) => body.message || body.error || ""),
  ])
  .catch("");

interface Sweep {
  route: string;
  status: number;
  message: string;
}

/** Calls every route of the console as an account. */
async function sweep(dms: Dms, as: string): Promise<Sweep[]> {
  const seen: Sweep[] = [];
  for (const [method, path] of ROUTES) {
    const answer = await dms.mon(path, {
      method,
      as,
      body: method === "POST" ? {} : undefined,
    });
    seen.push({
      route: `${method} ${path.split("?")[0]}`,
      status: answer.status,
      message: refusalSchema.parse(answer.body),
    });
  }
  return seen;
}

function permissionNamedFor(refused: Sweep[], route: string): string {
  const message = refused.find((entry) => entry.route === route)?.message;
  return /missing permission ([\w.-]+)/.exec(message ?? "")?.[1] ?? "";
}

describe("access", () => {
  test("every-console-route-needs-a-session-and-the-block-it-serves", async ({
    dms,
  }) => {
    await dms.traffic([{ path: "/fx/ok", count: 1 }]);
    await dms.member("plain", []);
    const anonymous = await sweep(dms, "anon");
    const plain = await sweep(dms, "plain");
    const owner = await sweep(dms, "admin");

    for (const entry of anonymous)
      expect.soft(entry.status, `${entry.route} is 401`).toBe(401);
    for (const entry of plain)
      expect
        .soft(
          entry.message,
          `${entry.route} refuses with its own block's permission`,
        )
        .toBe(
          entry.route === "GET /settings/summary"
            ? "Owner-only"
            : `Forbidden: missing permission ${BLOCK_OF.get(entry.route)}`,
        );
    for (const entry of owner)
      expect
        .soft(
          [401, 403].includes(entry.status),
          `${entry.route} passes the guard`,
        )
        .toBe(false);
  });

  test("the-console-is-the-owners-and-a-role-holding-a-block-is-refused", async ({
    dms,
  }) => {
    await dms.traffic([{ path: "/fx/ok", count: 1 }]);
    await dms.member("plain", []);
    const refused = await sweep(dms, "plain");
    const logsPermission = permissionNamedFor(refused, "GET /logs");
    const testerPermission = permissionNamedFor(refused, "GET /tester/source");
    expect
      .soft(
        logsPermission.startsWith("modules.api."),
        "the logs table has its own permission",
      )
      .toBe(true);
    expect
      .soft(
        testerPermission.startsWith("modules.api.") &&
          testerPermission !== logsPermission,
        "the Tester has its own permission",
      )
      .toBe(true);

    await dms.member("reader", [logsPermission]);
    await dms.member("tester", [testerPermission]);
    for (const account of ["reader", "tester"])
      for (const entry of await sweep(dms, account))
        expect
          .soft(entry.status, `${account}: ${entry.route} is refused`)
          .toBe(403);
    const owner = await sweep(dms, "admin");
    for (const route of ["GET /logs", "GET /tester/source"])
      expect
        .soft(
          owner.find((entry) => entry.route === route)?.status,
          `${route} opens`,
        )
        .toBe(200);
  });
});
