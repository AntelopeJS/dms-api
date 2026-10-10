import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
import { logsLink, routesLink } from "./links";
import type { HealthPayload, HealthVerdict } from "./overview";

const ERROR_SHARE_CRITICAL = 5;
const PERCENT = 100;

const VERDICT_TONE: Record<
  HealthVerdict,
  NonNullable<BannerContent["tone"]>
> = {
  operational: "success",
  degraded: "warning",
  down: "error",
  idle: "info",
};

const VERDICT_ICON: Record<HealthVerdict, string> = {
  operational: "i-ph-check-circle",
  degraded: "i-ph-warning",
  down: "i-ph-x-circle",
  idle: "i-ph-moon",
};

function text(key: string, params?: ComposedText["params"]): ComposedText {
  return params ? { key: `api.${key}`, params } : { key: `api.${key}` };
}

function count(value: number) {
  return { type: "count" as const, value };
}

/** "Degraded · since Oct 9, 14:02": the verdict and when it started. */
function verdictTitle(health: HealthPayload): ComposedText {
  const verdict = text(`health.verdict.${health.verdict}`);
  if (!health.since) return text("health.title", { verdict });
  const key =
    health.verdict === "operational"
      ? "health.title_last"
      : "health.title_since";
  return text(key, {
    verdict,
    date: { type: "datetime", value: health.since },
  });
}

/** Why the verdict: the failing and slow routes, or that there are none. */
function reasons(health: HealthPayload): ComposedText {
  if (health.failingRoutes > 0 && health.slowRoutes > 0) {
    return text("health.reasons.both", {
      failing: text("health.reasons.failing", {
        count: count(health.failingRoutes),
      }),
      slow: text("health.reasons.slow", { count: count(health.slowRoutes) }),
    });
  }
  if (health.failingRoutes > 0) {
    return text("health.reasons.failing", {
      count: count(health.failingRoutes),
    });
  }
  if (health.slowRoutes > 0) {
    return text("health.reasons.slow", { count: count(health.slowRoutes) });
  }
  return text(
    health.verdict === "idle" ? "health.reasons.idle" : "health.reasons.none",
  );
}

/**
 * The verdict leading the Overview, as a DMS `Banner`: its tone says how the
 * API is doing, its text why, and its action starts the investigation. With
 * no request captured yet, it explains how to get the first one in.
 */
export function healthBanner(health: HealthPayload): BannerContent {
  if (health.firstRun) {
    return {
      tone: "primary",
      icon: "i-ph-broadcast",
      title: text("health.first_run.title"),
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

function errorTone(share: number): StatGroupItem["detailTone"] {
  if (share >= ERROR_SHARE_CRITICAL) return "error";
  return share > 0 ? "warning" : "neutral";
}

/** The four headline figures under the verdict, as a DMS `StatGroup`. */
export function healthStats(health: HealthPayload): { items: StatGroupItem[] } {
  if (health.firstRun) return { items: [] };
  const delta = health.calls.delta;
  return {
    items: [
      {
        id: "calls",
        icon: "i-ph-arrows-left-right",
        eyebrow: "$api.health.metrics.calls",
        value: health.calls.value,
        detail:
          delta === null || delta === undefined
            ? "$api.health.metrics.calls_no_baseline"
            : text("health.metrics.calls_delta", {
                delta: {
                  type: "number",
                  value: delta / PERCENT,
                  format: "percent",
                },
              }),
        detailTone:
          delta === null || delta === undefined
            ? "neutral"
            : delta >= 0
              ? "success"
              : "warning",
        to: logsLink(),
      },
      {
        id: "errors",
        icon: "i-ph-warning-diamond",
        tone: health.errors.share > 0 ? "warning" : "muted",
        eyebrow: "$api.health.metrics.errors",
        value: text("health.metrics.errors_value", {
          share: {
            type: "number",
            value: health.errors.share / PERCENT,
            format: "percent",
          },
        }),
        detail: text("health.metrics.errors_sub", {
          count: count(health.errors.value),
        }),
        detailTone: errorTone(health.errors.share),
        to: logsLink({ tab: "5xx" }),
      },
      {
        id: "latency",
        icon: "i-ph-timer",
        eyebrow: "$api.health.metrics.latency",
        value: text("health.metrics.ms", {
          value: { type: "number", value: health.latency.value },
        }),
        detail: text("health.metrics.latency_sub", {
          max: { type: "number", value: health.latency.max },
        }),
      },
      {
        id: "routes",
        icon: "i-ph-tree-structure",
        tone: health.routes.needingAttention > 0 ? "warning" : "muted",
        eyebrow: "$api.health.metrics.routes",
        value: health.routes.value,
        detail: text("health.metrics.routes_sub", {
          count: count(health.routes.needingAttention),
        }),
        detailTone: health.routes.needingAttention > 0 ? "warning" : "neutral",
        to: routesLink(),
      },
    ],
  };
}
