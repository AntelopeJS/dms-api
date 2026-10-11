import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type {
  ComposedText,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base/types/composed-text";
import { logsLink, routesLink } from "./links";
import type { HealthPayload, HealthVerdict } from "./overview";

/**
 * The Overview's health as DMS blocks: the verdict as a `Banner` read from
 * `/overview/health`, the headline figures of the rules' window as a
 * `StatGroup` read from `/overview/health/figures`. Every text is composed in
 * the reader's language (`ComposedText`): the server sends the values, the
 * dashboard writes them.
 */

const MINUTES_PER_HOUR = 60;

const VERDICT_TONE: Record<
  HealthVerdict,
  NonNullable<BannerContent["tone"]>
> = {
  operational: "success",
  degraded: "warning",
  down: "error",
  recovered: "success",
  idle: "info",
};

const VERDICT_ICON: Record<HealthVerdict, string> = {
  operational: "i-ph-check-circle",
  degraded: "i-ph-warning",
  down: "i-ph-x-circle",
  recovered: "i-ph-arrow-counter-clockwise",
  idle: "i-ph-moon",
};

/** `api.<key>`, with its values. */
export function text(
  key: string,
  params?: Record<string, ComposedTextParam>,
): ComposedText {
  return params ? { key: `api.${key}`, params } : { key: `api.${key}` };
}

export function count(value: number): ComposedTextParam {
  return { type: "count", value };
}

export function number(value: number): ComposedTextParam {
  return { type: "number", value };
}

/** A rate already in percent (`3.3`), as "3.3%" / "3,3 %". */
export function percent(value: number): ComposedText {
  return text("common.percent", { value: number(value) });
}

/** A duration in milliseconds, as "296 ms". */
export function milliseconds(value: number): ComposedText {
  return text("common.ms", { value: number(Math.round(value)) });
}

/** The values joined by "·", in the reader's language. */
function joined(parts: ComposedText[]): ComposedText {
  const [first, ...rest] = parts;
  if (rest.length === 0) return first;
  return text("health.reasons.join", { first, rest: joined(rest) });
}

/** "Degraded since Oct 9, 14:02": the verdict, and since when it holds. */
function verdictTitle(health: HealthPayload): BannerContent["title"] {
  const since =
    health.verdict === "recovered" ? health.incidentEnd : health.incidentStart;
  const dated =
    health.verdict === "degraded" ||
    health.verdict === "down" ||
    health.verdict === "recovered";
  if (!dated || !since) return `$api.health.verdict.${health.verdict}`;
  return text(`health.since_${health.verdict}`, {
    date: { type: "datetime", value: since, format: "day" },
  });
}

/** Why the verdict: the failing, slow and recovered routes, or none. */
function reasons(health: HealthPayload): ComposedText {
  const parts: ComposedText[] = [];
  if (health.failingRoutes > 0)
    parts.push(
      text("health.reasons.failing", { count: count(health.failingRoutes) }),
    );
  if (health.slowRoutes > 0)
    parts.push(
      text("health.reasons.slow", {
        count: count(health.slowRoutes),
        threshold: milliseconds(health.thresholds.slowThresholdMs),
      }),
    );
  if (health.recoveredRoutes > 0)
    parts.push(
      text("health.reasons.recovered", {
        count: count(health.recoveredRoutes),
      }),
    );
  if (parts.length > 0) return joined(parts);
  if (health.verdict === "idle")
    return text("health.reasons.idle", {
      hours: number(health.healthWindow.minutes / MINUTES_PER_HOUR),
    });
  return text("health.reasons.none", {
    minutes: number(health.thresholds.windowMinutes),
  });
}

/**
 * The verdict leading the Overview, as a DMS `Banner`: its tone says how the
 * API is doing, its text since when and why, and its action opens the server
 * errors. Before any request was captured, it says how to get the first one.
 */
export function healthBanner(health: HealthPayload): BannerContent {
  if (health.firstRun) {
    return {
      tone: "primary",
      icon: "i-ph-broadcast",
      title: "$api.health.first_run.title",
      description: text("health.first_run.description", {
        count: count(health.routes.value),
      }),
      actions: [
        {
          label: "$api.health.first_run.browse",
          to: routesLink(),
          icon: "i-ph-tree-structure",
        },
        {
          label: "$api.health.first_run.logs",
          to: logsLink(),
          icon: "i-ph-list-magnifying-glass",
          variant: "outline",
          color: "neutral",
        },
      ],
    };
  }
  return {
    tone: VERDICT_TONE[health.verdict],
    icon: VERDICT_ICON[health.verdict],
    title: verdictTitle(health),
    description: reasons(health),
    actions:
      health.serverErrors > 0
        ? [
            {
              label: "$api.health.view_server_errors",
              to: health.serverErrorsLink,
              icon: "i-ph-list-magnifying-glass",
            },
          ]
        : [],
  };
}

/**
 * The four figures under the verdict, over the rules' window (15 min), as a
 * DMS `StatGroup`: the 5xx share the verdict rests on, the p95 against the
 * slow threshold, the traffic and the 4xx share.
 */
export function healthStats(health: HealthPayload): { items: StatGroupItem[] } {
  const { metrics, thresholds } = health;
  const minutes = number(thresholds.windowMinutes);
  const failing = metrics.serverErrorRate >= thresholds.degradedServerErrorRate;
  const slow =
    metrics.p95Ms !== null && metrics.p95Ms >= thresholds.slowThresholdMs;
  return {
    items: [
      {
        id: "server_errors",
        icon: "i-ph-x-circle",
        tone: failing ? "error" : "muted",
        eyebrow: text("health.metrics.server_errors", { minutes }),
        value: percent(metrics.serverErrorRate),
        detail: text("health.metrics.server_errors_rules", {
          degraded: percent(thresholds.degradedServerErrorRate),
          minutes,
          down: percent(thresholds.downServerErrorRate),
          downMinutes: number(thresholds.downWindowMinutes),
        }),
        detailTone: failing ? "error" : "neutral",
        to: health.serverErrorsLink,
      },
      {
        id: "p95",
        icon: "i-ph-timer",
        tone: slow ? "warning" : "muted",
        eyebrow: text("health.metrics.p95", { minutes }),
        value: metrics.p95Ms === null ? "—" : milliseconds(metrics.p95Ms),
        detail: text("health.metrics.p95_sub", {
          threshold: milliseconds(thresholds.slowThresholdMs),
        }),
        detailTone: slow ? "warning" : "neutral",
      },
      {
        id: "traffic",
        icon: "i-ph-arrows-left-right",
        eyebrow: text("health.metrics.traffic", { minutes }),
        value: text("health.metrics.per_minute_value", {
          value: number(metrics.requestsPerMinute),
        }),
        detail: text("health.metrics.traffic_sub", {
          count: count(health.routes.value),
        }),
        to: routesLink(),
      },
      {
        id: "client_errors",
        icon: "i-ph-warning",
        eyebrow: text("health.metrics.client_errors", { minutes }),
        value: percent(metrics.clientErrorRate),
        detail: "$api.health.metrics.client_errors_sub",
        to: logsLink({ tab: "4xx", window: "1h", from: "overview" }),
      },
    ],
  };
}

/** "p95 300 ms · max 300 ms · 6 calls" under a slowest route of the Overview. */
export function slowRouteDetail(route: {
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
