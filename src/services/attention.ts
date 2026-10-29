import type { ActivityFeedResponse } from "@antelopejs/interface-dms/base/activity-feed";
import type {
  BlockText,
  ComposedText,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { count, milliseconds, number, percent, text } from "./composed-text";
import {
  HEALTH_THRESHOLDS,
  type HealthVerdict,
  type RuleWindowInfo,
  ruleWindowsInfo,
} from "./health-rules";
import { logsLink, routeRef } from "./links";
import {
  type FeedItemPayload,
  inScopeRoutes,
  loadRouteHealth,
  type RangeInfo,
  rangeInfo,
  roundPercent,
} from "./overview";
import { isRegisteredRoute } from "./route-catalog";
import {
  type RouteHealthState,
  type RouteState,
  routesNeedingAttention,
} from "./route-health";
import {
  averageLatency,
  clientErrorShare,
  type SampleSource,
  type ScopeKeys,
  serverErrorShare,
} from "./traffic";

/**
 * "Needs attention": the routes the health rules flag over the last 24 h,
 * worst first, capped, each a DMS `ActivityFeed` entry whose details are
 * composed in the reader's language, with its numbers beside.
 */

const ATTENTION_FEED: Record<
  Exclude<RouteState, "healthy" | "idle">,
  Pick<FeedItemPayload, "icon" | "tone">
> = {
  failing: { icon: "i-ph-x-circle", tone: "error" },
  recovered: { icon: "i-ph-check-circle", tone: "success" },
  slow: { icon: "i-ph-timer", tone: "warning" },
  "client-errors": { icon: "i-ph-warning", tone: "warning" },
};

/** One "Needs attention" row: an `ActivityFeed` entry, and its numbers. */
export interface AttentionItem extends FeedItemPayload {
  route: string;
  /**
   * The route is one the API registers. False for a path no route answers
   * (a scanner's `GET /.env`, say), which the list groups apart.
   */
  known: boolean;
  state: RouteState;
  verdict: HealthVerdict;
  /** Over the lookback (`healthWindow`, 24 h): what a slow or 4xx state rests on. */
  metrics: {
    calls: number;
    serverErrors: number;
    clientErrors: number;
    /** In percent. */
    serverErrorRate: number;
    clientErrorRate: number;
    averageMs: number;
    p95Ms: number | null;
    maxMs: number;
  };
  /**
   * The window a failing or recovered state was judged on, and its 5xx rate
   * (in percent): the degraded rule's 15 minutes (further back while they
   * hold fewer than `minRequests` calls), the down rule's 5 minutes on a
   * Down verdict. Null for a slow or 4xx route, judged over the lookback.
   */
  stateWindow: RuleWindowInfo | null;
  topError: { status: number; message: string | null; count: number } | null;
  incident: { start: string | null; end: string | null } | null;
  /**
   * The route's last 5xx over the lookback (ISO), for a failing or recovered
   * one: a recovered route says since when it is, and its last 5xx, rather
   * than the rate of the burst its state window still holds.
   */
  lastServerError: string | null;
}

export interface AttentionPayload extends ActivityFeedResponse {
  items: AttentionItem[];
  /**
   * Every route needing attention, more than `items` when capped: the count
   * the feed shows beside its title.
   */
  count: number;
  limit: number;
  healthWindow: RangeInfo & { minutes: number };
  thresholds: typeof HEALTH_THRESHOLDS;
}

/** Rows "Needs attention" shows unless asked for more. */
export const ATTENTION_LIMIT = 8;

function topErrorOf(route: RouteHealthState) {
  const serverSide = route.state === "failing" || route.state === "recovered";
  return (
    route.errors.find((group) =>
      serverSide ? group.status >= 500 : group.status < 500,
    ) ?? null
  );
}

function attentionLink(route: RouteHealthState): string {
  const ref = routeRef(route.method, route.uri);
  if (route.state === "failing" || route.state === "recovered") {
    return logsLink({
      route: ref,
      tab: "5xx",
      period: "last-24h",
      from: "overview",
    });
  }
  if (route.state === "client-errors") {
    return logsLink({
      route: ref,
      tab: "4xx",
      period: "last-24h",
      from: "overview",
    });
  }
  return logsLink({
    route: ref,
    slow: true,
    period: "last-24h",
    from: "overview",
  });
}

function lastServerErrorOf(route: RouteHealthState): Date | null {
  if (route.state !== "failing" && route.state !== "recovered") return null;
  return route.errors.reduce<Date | null>(
    (latest, group) =>
      group.status >= 500 && (!latest || group.last > latest)
        ? group.last
        : latest,
    null,
  );
}

function stateWindowOf(route: RouteHealthState): RuleWindowInfo | null {
  if (route.state !== "failing" && route.state !== "recovered") return null;
  const windows = ruleWindowsInfo(route.windows);
  if (!windows) return null;
  return route.verdict === "down" ? windows.down : windows.degraded;
}

type TopError = ReturnType<typeof topErrorOf>;

/** `{status} "{message}" × {count}` of the route's top error. */
function topErrorText(top: NonNullable<TopError>): ComposedText {
  return top.message
    ? text("overview.attention.top_error", {
        status: String(top.status),
        message: top.message,
        count: number(top.count),
      })
    : text("overview.attention.top_status", {
        status: String(top.status),
        count: number(top.count),
      });
}

/**
 * Why a failing route is listed: its 5xx rate over the window of the rule
 * that judged it, else over the lookback.
 */
function failingDetail(
  route: RouteHealthState,
  window: RuleWindowInfo | null,
): ComposedText {
  if (window)
    return text("overview.attention.window_detail", {
      calls: count(window.requests),
      rate: percent(window.serverErrorRate),
      minutes: number(window.minutes),
      serverErrors: number(window.serverErrors),
    });
  return text("overview.attention.failing_detail", {
    calls: count(route.traffic.requests),
    rate: percent(roundPercent(serverErrorShare(route.traffic))),
    serverErrors: number(route.traffic.serverErrors),
  });
}

/**
 * The line under a route, by its state. A recovered route says since when,
 * and its last 5xx: the rate of its state window would still hold the burst.
 */
function stateDetail(
  route: RouteHealthState,
  window: RuleWindowInfo | null,
  lastServerError: Date | null,
): ComposedText {
  const { traffic } = route;
  switch (route.state) {
    case "recovered": {
      if (!lastServerError) return failingDetail(route, window);
      const last = {
        type: "relative" as const,
        value: lastServerError.toISOString(),
      };
      const end = route.incident?.end;
      return end
        ? text("overview.attention.recovered_detail", {
            end: { type: "relative", value: end.toISOString() },
            last,
          })
        : text("overview.attention.recovered_last", { last });
    }
    case "client-errors":
      return text("overview.attention.client_errors_detail", {
        calls: count(traffic.requests),
        rate: percent(roundPercent(clientErrorShare(traffic))),
        clientErrors: number(traffic.clientErrors),
      });
    case "slow":
      return text("overview.attention.slow_detail", {
        calls: count(traffic.requests),
        p95: route.p95Ms === null ? "—" : milliseconds(route.p95Ms),
        average: milliseconds(averageLatency(traffic)),
      });
    default:
      return failingDetail(route, window);
  }
}

function incidentOf(route: RouteHealthState) {
  if (!route.incident) return null;
  return {
    start: route.incident.start?.toISOString() ?? null,
    end: route.incident.end?.toISOString() ?? null,
  };
}

/**
 * The attention row of `route`. A path no route answers (a scanner's
 * `GET /.env`) says so first; the evidence is on a third line:
 * `500 "Cart is empty" × 16`.
 */
function attentionItem(
  route: ReturnType<typeof routesNeedingAttention>[number],
  known: boolean,
): AttentionItem {
  const { traffic } = route;
  const { state } = route;
  const key = state.replace("-", "_");
  const top = topErrorOf(route);
  const serverErrorRate = roundPercent(serverErrorShare(traffic));
  const clientErrorRate = roundPercent(clientErrorShare(traffic));
  const average = Math.round(averageLatency(traffic));
  const p95 = route.p95Ms === null ? null : Math.round(route.p95Ms);
  const stateWindow = stateWindowOf(route);
  const lastServerErrorAt = lastServerErrorOf(route);
  const lastServerError = lastServerErrorAt?.toISOString() ?? null;
  const meta: BlockText[] = [
    `$api.overview.attention.${key}`,
    stateDetail(route, stateWindow, lastServerErrorAt),
  ];
  if (!known) meta.unshift("$api.overview.attention.stray");
  const date =
    state === "recovered" ? route.incident?.end : route.incident?.start;
  return {
    id: route.key,
    ...ATTENTION_FEED[state],
    title: routeRef(route.method, route.uri),
    meta,
    ...(top && { detail: topErrorText(top) }),
    date: date?.toISOString(),
    to: attentionLink(route),
    route: routeRef(route.method, route.uri),
    known,
    state: route.state,
    verdict: route.verdict,
    metrics: {
      calls: traffic.requests,
      serverErrors: traffic.serverErrors,
      clientErrors: traffic.clientErrors,
      serverErrorRate,
      clientErrorRate,
      averageMs: average,
      p95Ms: p95,
      maxMs: Math.round(traffic.maxLatency),
    },
    stateWindow,
    topError: top
      ? { status: top.status, message: top.message, count: top.count }
      : null,
    incident: incidentOf(route),
    lastServerError,
  };
}

/**
 * Routes that need a look over the last 24 h, worst first, by the health
 * rules: at most `limit` of them, with how many there are in all. The
 * registered routes come first: stray paths never push one out of the cap.
 */
export async function getAttention(
  models: { logs: SampleSource },
  keys: ScopeKeys,
  limit: number = ATTENTION_LIMIT,
  now: Date = new Date(),
): Promise<AttentionPayload> {
  const { lookback, routes: health } = await loadRouteHealth(models, now);
  const flagged = routesNeedingAttention(inScopeRoutes(health, keys)).map(
    (route) => ({
      route,
      known: isRegisteredRoute(routeRef(route.method, route.uri)),
    }),
  );
  const routes = [
    ...flagged.filter(({ known }) => known),
    ...flagged.filter(({ known }) => !known),
  ];
  return {
    items: routes
      .slice(0, limit)
      .map(({ route, known }) => attentionItem(route, known)),
    count: routes.length,
    limit,
    healthWindow: {
      ...rangeInfo(lookback),
      minutes: HEALTH_THRESHOLDS.lookbackMinutes,
    },
    thresholds: HEALTH_THRESHOLDS,
  };
}
