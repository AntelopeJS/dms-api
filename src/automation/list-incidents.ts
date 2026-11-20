import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import { findIncidents, type Incident } from "@/services/activity";
import { logsLink } from "@/services/links";
import { scopeRouteKey } from "@/services/scope";
import { loadErrorSamples } from "@/services/traffic";
import {
  horizonOf,
  pinnedNow,
  presetRange,
  type TimeRange,
  type WindowPreset,
} from "@/services/window";
import {
  DATE_TIME,
  dateInput,
  nullable,
  objectSchema,
  PERIOD_INPUT,
  requireRouteRef,
  routeRefInput,
  truncateMessage,
} from "./outputs";
import { activeScopeKeys, refreshSettings } from "./scope";

interface ListIncidentsInput {
  period?: WindowPreset;
  since?: string;
  until?: string;
  route?: string;
  ongoingOnly?: boolean;
  limit?: number;
}

type IncidentOutput = {
  routeKey: string;
  route: string;
  start: string;
  end: string;
  ongoing: boolean;
  serverErrors: number;
  peakPerMinute: number;
  topErrorStatus: number;
  topErrorMessage: string | null;
  topErrorCount: number;
  logsPath: string;
};

type ListIncidentsOutput = {
  incidents: IncidentOutput[];
  total: number;
  from: string;
  to: string;
};

const DEFAULT_PERIOD: WindowPreset = "last-7-days";
const DEFAULT_LIMIT = 20;
const SERVER_ERROR = 500;

/**
 * The range a read covers: `since` to `until` (now by default) when `since`
 * is given, else the period up to now; never further back than the logs
 * are kept.
 */
export function readRange(
  input: { period?: WindowPreset; since?: string; until?: string },
  fallback: WindowPreset,
  now: Date = pinnedNow(),
): TimeRange {
  const since = dateInput("since", input.since);
  const until = dateInput("until", input.until) ?? now;
  const range = since
    ? { from: since, to: until }
    : presetRange(input.period ?? fallback, now);
  const horizon = horizonOf("minute", now);
  return {
    from: range.from < horizon ? horizon : range.from,
    to: range.to,
  };
}

export function incidentOutput(incident: Incident): IncidentOutput {
  return {
    routeKey: incident.key,
    route: incident.route,
    start: incident.start.toISOString(),
    end: incident.end.toISOString(),
    ongoing: incident.ongoing,
    serverErrors: incident.serverErrors,
    peakPerMinute: incident.peakPerMinute,
    topErrorStatus: incident.topError.status,
    topErrorMessage: truncateMessage(incident.topError.message),
    topErrorCount: incident.topError.count,
    logsPath: logsLink({
      route: incident.route,
      range: {
        from: incident.start,
        to: new Date(incident.end.getTime() + 1),
      },
      tab: "5xx",
    }),
  };
}

export const listIncidentsAction: ActionType<
  ListIncidentsInput,
  ListIncidentsOutput
> = {
  id: "api.list-incidents",
  name: "List incidents",
  description:
    "Per-route incidents (runs of 5xx) over a period, newest first, each with its top error",
  icon: "i-ph-siren",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      period: {
        ...PERIOD_INPUT,
        default: DEFAULT_PERIOD,
        description: "Ignored when since is set",
      },
      since: { ...DATE_TIME, description: "Custom start" },
      until: {
        ...DATE_TIME,
        description: "Custom end, exclusive; now by default",
      },
      route: routeRefInput("One route only"),
      ongoingOnly: { type: "boolean", default: false },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    incidents: {
      type: "array",
      items: objectSchema({
        routeKey: { type: "string" },
        route: { type: "string" },
        start: { ...DATE_TIME, description: "First 5xx" },
        end: { ...DATE_TIME, description: "Last 5xx" },
        ongoing: {
          type: "boolean",
          description: "Last 5xx less than 15 minutes ago",
        },
        serverErrors: { type: "integer" },
        peakPerMinute: { type: "integer" },
        topErrorStatus: { type: "integer" },
        topErrorMessage: nullable("string"),
        topErrorCount: { type: "integer" },
        logsPath: { type: "string" },
      }),
    },
    total: { type: "integer", description: "Before the limit" },
    from: DATE_TIME,
    to: DATE_TIME,
  }),
  async execute(input) {
    const route = input.route ? requireRouteRef(input.route) : undefined;
    let keys: Set<string> | null;
    if (route) {
      await refreshSettings();
      keys = new Set([scopeRouteKey(route.method, route.path)]);
    } else {
      keys = await activeScopeKeys();
    }
    const now = pinnedNow();
    const range = readRange(input, DEFAULT_PERIOD, now);
    const errors = await loadErrorSamples(
      GetModel(RequestLogModel),
      range,
      keys,
      SERVER_ERROR,
    );
    const incidents = findIncidents(errors, now.getTime()).filter(
      (incident) => !input.ongoingOnly || incident.ongoing,
    );
    return {
      incidents: incidents
        .slice(0, input.limit ?? DEFAULT_LIMIT)
        .map(incidentOutput),
      total: incidents.length,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    };
  },
};
