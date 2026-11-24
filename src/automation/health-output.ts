import type { JsonSchema } from "@antelopejs/interface-dms-automation";
import { logsLink, serverErrorsLink } from "@/services/links";
import type { HealthPayload, HealthVerdict } from "@/services/overview";
import type { RouteScope } from "@/services/scope";
import { DATE_TIME, nullable, VERDICTS } from "./outputs";

/** The API verdict as the health nodes hand it on. */
export type HealthOutput = {
  verdict: HealthVerdict;
  verdictSince: string | null;
  incidentStart: string | null;
  incidentEnd: string | null;
  durationMs: number | null;
  serverErrorRate: number;
  clientErrorRate: number;
  p95Ms: number | null;
  requestsPerMinute: number;
  calls24h: number;
  serverErrors24h: number;
  recoveredRoutes: number;
  routesNeedingAttention: number;
  scope: RouteScope;
  logsPath: string;
  checkedAt: string;
};

function incidentLogs(payload: HealthPayload): string {
  if (!payload.incidentStart && !payload.incidentEnd) return serverErrorsLink();
  return logsLink({
    range: {
      from: new Date(payload.incidentStart ?? payload.healthWindow.from),
      to: payload.incidentEnd ? new Date(payload.incidentEnd) : undefined,
    },
    tab: "5xx",
  });
}

/**
 * The verdict fields of the Overview's health, as the nodes hand them on.
 * `verdictSince` is the end of the evaluated lookback minus how long the
 * verdict has held.
 */
export function healthOutput(
  payload: HealthPayload,
  scope: RouteScope,
): HealthOutput {
  return {
    verdict: payload.verdict,
    verdictSince:
      payload.durationMs === null
        ? null
        : new Date(
            Date.parse(payload.healthWindow.to) - payload.durationMs,
          ).toISOString(),
    incidentStart: payload.incidentStart,
    incidentEnd: payload.incidentEnd,
    durationMs: payload.durationMs,
    serverErrorRate: payload.metrics.serverErrorRate,
    clientErrorRate: payload.metrics.clientErrorRate,
    p95Ms: payload.metrics.p95Ms,
    requestsPerMinute: payload.metrics.requestsPerMinute,
    calls24h: payload.calls.value,
    serverErrors24h: payload.serverErrors,
    recoveredRoutes: payload.recoveredRoutes,
    routesNeedingAttention: payload.routes.needingAttention,
    scope,
    logsPath: incidentLogs(payload),
    checkedAt: payload.checkedAt,
  };
}

export const HEALTH_OUTPUT_PROPERTIES = {
  verdict: { type: "string", enum: [...VERDICTS] },
  verdictSince: nullable("string", {
    format: "date-time",
    description: "Since when the verdict holds; null when longer than 24 h",
  }),
  incidentStart: nullable("string", { format: "date-time" }),
  incidentEnd: nullable("string", {
    format: "date-time",
    description: "Null while the incident lasts",
  }),
  durationMs: nullable("number", {
    description: "How long the verdict has held",
  }),
  serverErrorRate: {
    type: "number",
    description: "5xx share in percent, last 15 minutes",
  },
  clientErrorRate: {
    type: "number",
    description: "4xx share in percent, last 15 minutes",
  },
  p95Ms: nullable("number", { description: "Last 15 minutes" }),
  requestsPerMinute: { type: "number", description: "Last 15 minutes" },
  calls24h: { type: "number", description: "Rolling 24 h, from the logs" },
  serverErrors24h: {
    type: "number",
    description: "Rolling 24 h, from the logs",
  },
  recoveredRoutes: { type: "number" },
  routesNeedingAttention: { type: "number" },
  scope: { type: "string", enum: ["own", "modules", "all"] },
  logsPath: { type: "string", description: "The incident's 5xx in the logs" },
  checkedAt: DATE_TIME,
} satisfies Record<string, JsonSchema>;
