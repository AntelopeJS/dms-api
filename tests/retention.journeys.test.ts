import { resolve } from "node:path";
import { describe, expect } from "vitest";
import { z } from "zod";
import { type Dms, type Answer, test } from "./helpers/dms";
import {
  dayStart,
  readDocuments,
  seedLogs,
  seedStatistics,
} from "./helpers/seed";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const CLOCK = resolve(__dirname, "../e2e/clock.cjs");
const PRUNE_DEADLINE_MS = 90_000;
const PRUNE_POLL_MS = 1000;
const PRUNE_SETTLE_MS = 3000;

const impactSchema = z.object({ days: z.number(), requests: z.number() });
const loggedSchema = z.object({ timestamp: z.date() });
const statisticsSchema = z.object({
  statistics: z.array(z.object({ day: z.number() })),
});

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function figures(answer: Answer): number[] {
  const { days, requests } = impactSchema.parse(answer.body);
  return [days, requests];
}

async function assertLoweringARetentionTellsWhatTheNextPruneDeletes(
  dms: Dms,
): Promise<void> {
  await seedLogs(dms, { daysAgo: 40, count: 3 });
  await seedLogs(dms, { daysAgo: 99.5, count: 2 });
  await seedStatistics(dms, {
    method: "GET",
    uri: "/fx/ok",
    daysAgo: 50,
    requests: 4,
  });
  await seedStatistics(dms, {
    method: "GET",
    uri: "/fx/ok",
    daysAgo: 70,
    requests: 6,
  });
  const read = (field: string, days: number) =>
    dms.mon(`/settings/retention-impact?field=${field}&days=${days}`);
  const logs30 = await read("requestLogRetentionDays", 30);
  const logs60 = await read("requestLogRetentionDays", 60);
  const logs366 = await read("requestLogRetentionDays", 366);
  const stats30 = await read("statisticsLifetimeDays", 30);
  const stats60 = await read("statisticsLifetimeDays", 60);
  const stats90 = await read("statisticsLifetimeDays", 90);
  const unknown = await read("nope", 30);
  const zero = await read("requestLogRetentionDays", 0);
  const over = await read("requestLogRetentionDays", 367);
  expect
    .soft(
      figures(logs30),
      "logs older than 30 days: the days back they reach and the requests",
    )
    .toEqual([70, 5]);
  expect.soft(figures(logs60), "logs older than 60 days").toEqual([40, 2]);
  expect.soft(figures(logs366), "logs older than 366 days").toEqual([0, 0]);
  expect
    .soft(
      figures(stats30),
      "statistics older than 30 days: the 50 and 70 day old rollups",
    )
    .toEqual([2, 10]);
  expect
    .soft(
      figures(stats60),
      "statistics older than 60 days: the 70 day old rollup",
    )
    .toEqual([1, 6]);
  expect
    .soft(figures(stats90), "statistics older than 90 days")
    .toEqual([0, 0]);
  expect.soft(unknown.status, "an unknown field is refused").toBe(400);
  expect.soft(zero.status, "0 days is refused").toBe(400);
  expect.soft(over.status, "367 days is refused").toBe(400);
}

async function assertTheHourlyPruneDeletesWhatTheRetentionPassed(
  dms: Dms,
): Promise<void> {
  await dms.saveSettings({
    requestLogRetentionDays: 20,
    statisticsLifetimeDays: 30,
  });
  await seedLogs(dms, { daysAgo: 39.5, count: 3 });
  await seedLogs(dms, {
    daysAgo: 25,
    count: 2,
    uri: "/fx/boom",
    statusCode: 500,
  });
  await seedLogs(dms, { daysAgo: 10, count: 4 });
  await seedLogs(dms, { daysAgo: 1 / 24, count: 1 });
  for (const [daysAgo, requests] of [
    [100, 4],
    [40, 6],
    [10, 8],
  ] as const)
    await seedStatistics(dms, {
      method: "GET",
      uri: "/fx/ok",
      daysAgo,
      requests,
    });
  const impact = await dms.mon(
    "/settings/retention-impact?field=requestLogRetentionDays&days=20",
  );
  const seeded = () =>
    readDocuments(dms, "dms-api__request_log", loggedSchema, {
      userAgent: "seed",
    });
  const before = (await seeded()).length;
  const toNextHour = MS_PER_HOUR - (Date.now() % MS_PER_HOUR);
  const offset =
    (toNextHour > 20_000 ? toNextHour : toNextHour + MS_PER_HOUR) - 12_000;
  const previous = { ...dms.backend.extraEnv };
  dms.backend.extraEnv = {
    ...previous,
    NODE_OPTIONS: `--require ${CLOCK}`,
    VERIFY_API_CLOCK_OFFSET_MS: String(offset),
  };
  try {
    await dms.restart();
    const deadline = Date.now() + PRUNE_DEADLINE_MS;
    let after = before;
    while (Date.now() < deadline && after > 5) {
      await sleep(PRUNE_POLL_MS);
      after = (await seeded()).length;
    }
    await sleep(PRUNE_SETTLE_MS);
  } finally {
    dms.backend.extraEnv = previous;
  }
  const ages = (await seeded())
    .map((row) =>
      Math.round((Date.now() - row.timestamp.getTime()) / MS_PER_DAY),
    )
    .toSorted((left, right) => left - right);
  const stats = await readDocuments(
    dms,
    "dms-api__routes_statistics",
    statisticsSchema,
    { _id: "GET:/fx/ok" },
  );
  const days = (stats[0]?.statistics ?? [])
    .map((entry) => entry.day)
    .toSorted((left, right) => left - right);
  expect
    .soft(
      figures(impact),
      "the impact said 5 requests reaching back 20 days before",
    )
    .toEqual([20, 5]);
  expect.soft(before, "the logs before").toBe(10);
  expect
    .soft(ages, "the logs left are the four 10 days old and the hour old one")
    .toEqual([0, 10, 10, 10, 10]);
  expect
    .soft(
      days,
      "the statistics left are the 10 days old and the 40 days old are gone with the 100 days old",
    )
    .toEqual([dayStart(10)]);
}

describe("retention", () => {
  test("lowering-a-retention-tells-what-the-next-prune-deletes", ({ dms }) =>
    assertLoweringARetentionTellsWhatTheNextPruneDeletes(dms));
  test("the-hourly-prune-deletes-what-the-retention-passed", ({ dms }) =>
    assertTheHourlyPruneDeletesWhatTheRetentionPassed(dms));
});
