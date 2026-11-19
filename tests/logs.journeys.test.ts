import { describe, expect } from "vitest";
import { z } from "zod";
import { type Dms, test } from "./helpers/dms";
import { type Json, resultsOf } from "./helpers/json";
import { seedLogs } from "./helpers/seed";

const MS_PER_DAY = 86_400_000;

const listSchema = z.object({
  total: z.number(),
  results: z.array(z.object({ path: z.string() })),
});
const statusSchema = z.object({ status: z.string() });
const timestampSchema = z.object({ timestamp: z.string() });
const liveSchema = z.object({
  total: z.number(),
  clientErrors: z.number(),
  serverErrors: z.number(),
  buckets: z.array(
    z.object({
      start: z.number(),
      success: z.number().default(0),
      clientErrors: z.number().default(0),
      serverErrors: z.number().default(0),
    }),
  ),
});

type Bucket = z.infer<typeof liveSchema>["buckets"][number];

async function listed(
  dms: Dms,
  query: string,
): Promise<{ total: number; paths: string[] }> {
  const answer = await dms.mon(`/logs?preset=last-24h&${query}`);
  const parsed = listSchema.parse(answer.body);
  return { total: parsed.total, paths: parsed.results.map((row) => row.path) };
}

function byClass(buckets: Bucket[]): number[] {
  return [
    buckets.reduce((sum, bucket) => sum + bucket.success, 0),
    buckets.reduce((sum, bucket) => sum + bucket.clientErrors, 0),
    buckets.reduce((sum, bucket) => sum + bucket.serverErrors, 0),
  ];
}

function totalsOf(body: Json): number[] {
  const live = liveSchema.parse(body);
  return [live.total, live.clientErrors, live.serverErrors];
}

interface Pages {
  first: { total: number; paths: string[] };
  second: { total: number; paths: string[] };
  ascending: string[];
  descending: string[];
  oldest: { statuses: string[]; at: number };
  newestAt: number;
}

async function statusesAndTimes(
  dms: Dms,
  query: string,
): Promise<{ statuses: string[]; at: number }> {
  const answer = await dms.mon(`/logs?preset=last-24h&${query}`);
  return {
    statuses: resultsOf(answer.body, statusSchema).map((row) => row.status),
    at: Date.parse(resultsOf(answer.body, timestampSchema)[0]?.timestamp ?? ""),
  };
}

async function readPages(dms: Dms): Promise<Pages> {
  await seedLogs(dms, { daysAgo: 0.01, count: 58 });
  await seedLogs(dms, {
    daysAgo: 0.02,
    count: 2,
    statusCode: 404,
    uri: "/fx/missing",
    message: "seeded",
  });
  return {
    first: await listed(dms, ""),
    second: await listed(dms, "offset=50"),
    ascending: (
      await statusesAndTimes(dms, "sortKey=status&sortDirection=asc&limit=3")
    ).statuses,
    descending: (
      await statusesAndTimes(dms, "sortKey=status&sortDirection=desc&limit=3")
    ).statuses,
    oldest: await statusesAndTimes(
      dms,
      "sortKey=timestamp&sortDirection=asc&limit=2",
    ),
    newestAt: (await statusesAndTimes(dms, "limit=2")).at,
  };
}

async function seedPastDays(dms: Dms): Promise<void> {
  await seedLogs(dms, { daysAgo: 3, count: 4, uri: "/fx/ok" });
  await seedLogs(dms, {
    daysAgo: 3,
    count: 2,
    uri: "/fx/missing",
    statusCode: 404,
  });
  await seedLogs(dms, {
    daysAgo: 3,
    count: 1,
    uri: "/fx/boom",
    statusCode: 500,
  });
  await seedLogs(dms, { daysAgo: 10, count: 2, uri: "/fx/ok" });
}

async function barsOf(
  dms: Dms,
  startDays: number,
  endDays: number,
): Promise<number> {
  const from = new Date(Date.now() - startDays * MS_PER_DAY).toISOString();
  const to = new Date(Date.now() - endDays * MS_PER_DAY).toISOString();
  const answer = await dms.mon(
    `/logs/live?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return liveSchema.parse(answer.body).buckets.length;
}

async function sendEightCalls(dms: Dms): Promise<void> {
  await dms.saveSettings({ requestSlownessThresholdMs: 50 });
  await dms.traffic([
    { path: "/fx/ok", count: 3 },
    { path: "/fx/slow?ms=80", count: 1 },
    {
      path: "/fx/echo",
      count: 2,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    { path: "/fx/boom", count: 1 },
    { path: "/fx/missing", count: 1 },
  ]);
  await dms.settled(
    "/logs?preset=last-24h",
    (body) => listSchema.safeParse(body).data?.total === 8,
  );
}

const ECHO = encodeURIComponent("POST /fx/echo");

const FILTER_CASES: {
  label: string;
  query: string;
  total: number;
  paths: string[];
}[] = [
  {
    label: "2xx and POST",
    query: "filter_statusClass=is:2xx&filter_method=is:POST",
    total: 2,
    paths: ["/fx/echo"],
  },
  {
    label: "2xx and GET",
    query: "filter_statusClass=is:2xx&filter_method=is:GET",
    total: 4,
    paths: ["/fx/ok", "/fx/slow"],
  },
  {
    label: "4xx and GET",
    query: "filter_statusClass=is:4xx&filter_method=is:GET",
    total: 1,
    paths: ["/fx/missing"],
  },
  {
    label: "4xx and POST",
    query: "filter_statusClass=is:4xx&filter_method=is:POST",
    total: 0,
    paths: [],
  },
  {
    label: "5xx and slow",
    query: "filter_statusClass=is:5xx&filter_slow=is:true",
    total: 0,
    paths: [],
  },
  {
    label: "2xx and slow",
    query: "filter_statusClass=is:2xx&filter_slow=is:true",
    total: 1,
    paths: ["/fx/slow"],
  },
  {
    label: "slow and POST",
    query: "filter_slow=is:true&filter_method=is:POST",
    total: 0,
    paths: [],
  },
  {
    label: "2xx and a route",
    query: `filter_statusClass=is:2xx&filter_route=is:${ECHO}`,
    total: 2,
    paths: ["/fx/echo"],
  },
  {
    label: "a route under another tab",
    query: `filter_statusClass=is:5xx&filter_route=is:${ECHO}`,
    total: 0,
    paths: [],
  },
];

const BAR_RANGES: [number, number][] = [
  [3, 2],
  [6, 1],
  [20, 10],
  [50, 2],
  [0.1, 0.05],
];

describe("logs", () => {
  test("the-list-is-newest-first-sorts-and-pages", async ({ dms }) => {
    const pages = await readPages(dms);
    expect.soft(pages.first.total, "the total").toBe(60);
    expect
      .soft(pages.first.paths.length, "the first page holds 50 rows")
      .toBe(50);
    expect
      .soft(pages.second.paths.length, "the second page holds the other 10")
      .toBe(10);
    expect
      .soft(pages.ascending, "status ascending starts with a 200")
      .toEqual(["200", "200", "200"]);
    expect
      .soft(
        pages.descending.slice(0, 2),
        "status descending starts with the 404s",
      )
      .toEqual(["404", "404"]);
    expect
      .soft(pages.newestAt, "newest first")
      .toBeGreaterThan(pages.oldest.at);
    expect
      .soft(pages.oldest.statuses, "the oldest rows are the two 404s")
      .toEqual(["404", "404"]);
  });

  test("the-histogram-counts-past-days-by-class", async ({ dms }) => {
    await seedPastDays(dms);
    const at = Date.now() - 3 * MS_PER_DAY;
    const week = await dms.mon("/logs/live?preset=last-7-days");
    const month = await dms.mon("/logs/live?preset=last-30-days");
    const weekBuckets = liveSchema.parse(week.body).buckets;
    const near = weekBuckets.filter(
      (bucket) => Math.abs(bucket.start - at) <= 2 * 7_200_000,
    );
    expect.soft(totalsOf(week.body), "7D: the totals").toEqual([7, 2, 1]);
    expect
      .soft(byClass(weekBuckets), "7D: the bars by class")
      .toEqual([4, 2, 1]);
    expect
      .soft(byClass(near), "7D: the bars around 3 days ago hold them")
      .toEqual([4, 2, 1]);
    expect
      .soft(
        totalsOf(month.body),
        "30D: the totals, the calls of 10 days ago included",
      )
      .toEqual([9, 2, 1]);
    expect
      .soft(
        byClass(liveSchema.parse(month.body).buckets),
        "30D: the bars by class",
      )
      .toEqual([6, 2, 1]);
  });

  test("a-past-range-draws-at-most-120-bars", async ({ dms }) => {
    for (const [startDays, endDays] of BAR_RANGES) {
      const bars = await barsOf(dms, startDays, endDays);
      expect
        .soft(
          bars >= 50 && bars <= 120,
          `${startDays} to ${endDays} days ago: 50 to 120 bars (${bars})`,
        )
        .toBe(true);
    }
  });

  test("filters-combine-with-the-status-tab", async ({ dms }) => {
    await sendEightCalls(dms);
    for (const { label, query, total, paths } of FILTER_CASES) {
      const got = await listed(dms, query);
      expect
        .soft([got.total, [...new Set(got.paths)].toSorted()], label)
        .toEqual([total, paths]);
    }
  });
});
