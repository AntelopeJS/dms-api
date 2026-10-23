import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
import { shownComparison, versusText, withVersus } from "./comparison";
import { count, milliseconds, percent, text } from "./composed-text";
import { logsLink, routeLink, routeRef } from "./links";
import {
  type OverviewModels,
  roundPercent,
  scopedWindowTraffic,
  type TopListItemPayload,
} from "./overview";
import {
  averageLatency,
  p95Latency,
  type ScopeKeys,
  sumBuckets,
  type TrafficBucket,
  type WindowTraffic,
  windowTraffic,
} from "./traffic";
import { describeWindow, type TimeWindow, type WindowInfo } from "./window";

/**
 * The Overview's top lists over the page's period: the responses by status
 * class and the slowest routes, each row against the period compared with.
 */

type StatusClass = "2xx" | "4xx" | "5xx";

interface StatusClassRow {
  id: StatusClass;
  icon: string;
  count: (bucket: TrafficBucket) => number;
}

const STATUS_CLASS_ROWS: StatusClassRow[] = [
  {
    id: "2xx",
    icon: "i-ph-check-circle",
    count: (bucket) =>
      bucket.requests - bucket.clientErrors - bucket.serverErrors,
  },
  {
    id: "4xx",
    icon: "i-ph-warning",
    count: (bucket) => bucket.clientErrors,
  },
  {
    id: "5xx",
    icon: "i-ph-x-circle",
    count: (bucket) => bucket.serverErrors,
  },
];

/** A status class row: its count as the value, its share as a number. */
export interface StatusClassItem extends TopListItemPayload {
  statusClass: StatusClass;
  /** Share of the window's calls, in percent (one decimal). */
  share: number;
}

/**
 * Responses by status class over the window, with their share and, under a
 * comparison, their calls against the period compared with ("12.4 % of
 * calls · +8 % vs. 1,020 previous period").
 */
export async function getStatusClasses(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: StatusClassItem[]; total: number; window: WindowInfo }> {
  const { current, previous } = await scopedWindowTraffic(models, window, keys);
  const total = sumBuckets(current);
  const before = previous ? sumBuckets(previous) : null;
  const comparison = shownComparison(window);
  const info = describeWindow(window);
  if (total.requests === 0) return { items: [], total: 0, window: info };
  return {
    items: STATUS_CLASS_ROWS.map((row) => {
      const calls = row.count(total);
      const share = text("overview.classes.share", {
        share: percent(roundPercent(calls / total.requests)),
      });
      return {
        id: row.id,
        statusClass: row.id,
        title: `$api.overview.classes.${row.id}`,
        description: withVersus(
          share,
          comparison && before
            ? versusText(comparison, calls, row.count(before), count)
            : undefined,
        ),
        value: calls,
        share: roundPercent(calls / total.requests),
        icon: row.icon,
        to: logsLink({ tab: row.id, period: window.preset, from: "overview" }),
      };
    }),
    total: total.requests,
    window: info,
  };
}

const SLOWEST_LIMIT = 5;

/** A slowest-routes row: its average as the value, the rest as numbers. */
export interface SlowRouteItem extends TopListItemPayload {
  route: string;
  averageMs: number;
  /**
   * Exact over a window read from the logs, estimated from the latency
   * histograms over a longer one, never above `maxMs`; null without a
   * measured call.
   */
  p95Ms: number | null;
  maxMs: number;
  requests: number;
}

/** "p95 300 ms · max 300 ms · 6 calls" under a slowest route of the Overview. */
function slowRouteDetail(route: {
  p95: number | null;
  calls: number;
  max: number;
}): ComposedText {
  const figures = { calls: count(route.calls), max: milliseconds(route.max) };
  if (route.p95 === null)
    return text("overview.slowest.detail_no_p95", figures);
  return text("overview.slowest.detail", {
    ...figures,
    p95: milliseconds(route.p95),
  });
}

/**
 * A route's average against its average over the period compared with:
 * "none over the previous period" for a route nobody called then; nothing
 * without a comparison.
 */
function slowRouteVersus(
  window: TimeWindow,
  average: number,
  previous: WindowTraffic | null,
  key: string,
): ComposedText | undefined {
  const comparison = shownComparison(window);
  if (!comparison || !previous) return undefined;
  const total = sumBuckets(previous.routes.get(key) ?? []);
  const before = total.timed > 0 ? Math.round(averageLatency(total)) : 0;
  return versusText(comparison, average, before, milliseconds);
}

/**
 * The routes with the highest average latency over the window, each with
 * its average over the period compared with when there is one.
 */
export async function getSlowestRoutes(
  models: OverviewModels,
  window: TimeWindow,
  keys: ScopeKeys,
): Promise<{ items: SlowRouteItem[]; window: WindowInfo }> {
  const [traffic, previous] = await Promise.all([
    windowTraffic(models, window, window.granularity),
    window.previous
      ? windowTraffic(models, window.previous, window.granularity)
      : Promise.resolve(null),
  ]);
  const rows: Array<{ key: string; total: TrafficBucket }> = [];
  for (const [key, buckets] of traffic.routes) {
    if (keys && !keys.has(key)) continue;
    const total = sumBuckets(buckets);
    if (total.requests > 0) rows.push({ key, total });
  }
  const items = rows
    .sort((a, b) => averageLatency(b.total) - averageLatency(a.total))
    .slice(0, SLOWEST_LIMIT)
    .map(({ key, total }) => {
      const separator = key.indexOf(":");
      const ref = routeRef(key.slice(0, separator), key.slice(separator + 1));
      const p95 = p95Latency(total);
      const average = Math.round(averageLatency(total));
      return {
        id: ref,
        title: ref,
        description: withVersus(
          slowRouteDetail({
            p95,
            calls: total.requests,
            max: total.maxLatency,
          }),
          slowRouteVersus(window, average, previous, key),
        ),
        route: ref,
        value: average,
        averageMs: average,
        p95Ms: p95 === null ? null : Math.round(p95),
        maxMs: Math.round(total.maxLatency),
        requests: total.requests,
        to: routeLink(ref, undefined, window.preset),
      };
    });
  return { items, window: describeWindow(window) };
}
