import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./helpers/dms";
import type { Json } from "./helpers/json";
import { seedLogs } from "./helpers/seed";

const healthSchema = z.object({
  verdict: z.string(),
  metrics: z.object({ requests: z.number(), serverErrorRate: z.number() }),
});
const trafficSchema = z.object({
  value: z.number(),
  series: z.array(z.object({ name: z.string() })),
  window: z.object({
    comparison: z.string(),
    previous: z.union([z.null(), z.object({})]),
    previousAvailable: z.boolean(),
  }),
});

function requestsOf(body: Json): number | undefined {
  return healthSchema.safeParse(body).data?.metrics.requests;
}

function tenthsOf(rate: number): number {
  return Math.round(rate * 10) / 10;
}

describe("overview", () => {
  test("down-reads-the-last-five-minutes-and-not-the-last-fifteen", async ({
    dms,
  }) => {
    await seedLogs(dms, { minutesAgo: 10, count: 100 });
    await dms.traffic([
      { path: "/fx/ok", count: 10 },
      { path: "/fx/boom", count: 10 },
    ]);
    const recent = await dms.settled(
      "/overview/health",
      (body) => requestsOf(body) === 120,
    );
    const health = healthSchema.parse(recent.body);
    expect.soft(health.verdict, "the verdict").toBe("down");
    expect
      .soft(
        [health.metrics.requests, tenthsOf(health.metrics.serverErrorRate)],
        "the 15-minute rate is the 10 errors over 120 calls",
      )
      .toEqual([120, 8.3]);
  });

  test("errors-older-than-five-minutes-do-not-make-the-api-down", async ({
    dms,
  }) => {
    await seedLogs(dms, { minutesAgo: 10, count: 80 });
    await seedLogs(dms, {
      minutesAgo: 10,
      count: 40,
      uri: "/fx/boom",
      statusCode: 500,
      message: "seeded",
    });
    await dms.traffic([{ path: "/fx/ok", count: 20 }]);
    const aged = await dms.settled(
      "/overview/health",
      (body) => requestsOf(body) === 140,
    );
    const health = healthSchema.parse(aged.body);
    expect.soft(health.verdict, "the verdict").toBe("degraded");
    expect
      .soft(
        tenthsOf(health.metrics.serverErrorRate),
        "the 15-minute rate is the 40 errors over 140 calls",
      )
      .toBe(28.6);
  });

  test("a-comparison-the-page-does-not-know-compares-with-nothing", async ({
    dms,
  }) => {
    await dms.traffic([{ path: "/fx/ok", count: 3 }]);
    await dms.settled(
      "/overview/traffic?preset=last-24h",
      (body) => trafficSchema.safeParse(body).data?.value === 3,
    );
    const windowOf = async (
      name: string,
    ): Promise<[string, boolean, boolean, number]> => {
      const answer = await dms.mon(
        `/overview/traffic?preset=last-24h&comparison=${name}`,
      );
      const traffic = trafficSchema.parse(answer.body);
      return [
        traffic.window.comparison,
        traffic.window.previous === null,
        traffic.window.previousAvailable,
        traffic.series.length,
      ];
    };
    expect
      .soft(await windowOf("previous-year"), "previous-year")
      .toEqual(["none", true, false, 3]);
    expect
      .soft(await windowOf("year"), "year")
      .toEqual(["none", true, false, 3]);
    expect
      .soft(await windowOf(""), "an empty name")
      .toEqual(["none", true, false, 3]);
    expect
      .soft(await windowOf("none"), "none")
      .toEqual(["none", true, false, 3]);
    expect
      .soft(await windowOf("previous-period"), "previous-period")
      .toEqual(["previous-period", false, true, 3]);
  });
});
