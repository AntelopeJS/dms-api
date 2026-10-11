import type { RequestLogSample } from "@/db/models/request_log.model";
import type { Route } from "@/db/tables/routes.table";
import { MS_PER_DAY, MS_PER_MINUTE } from "@/types";
import { HEALTH_THRESHOLDS } from "./health-rules";
import { logsLink, routeLink, routeRef, routesLink } from "./links";
import type { FeedItemPayload, OverviewModels } from "./overview";
import { scopeRouteKey } from "./scope";
import { loadErrorSamples, type SampleSource, type ScopeKeys } from "./traffic";
import {
  pinnedNow,
  presetRange,
  type TimeRange,
  type WindowPreset,
} from "./window";

const ACTIVITY_LIMIT = 8;

/** What the journal reads: the 5xx of the logs, and the routes registered. */
export interface ActivityModels {
  logs: SampleSource;
  routes: Pick<OverviewModels["routes"], "getAll">;
}

/** What the journal covers. */
export const ACTIVITY_WINDOW: WindowPreset = "7d";

/**
 * Quiet time that closes an incident: the window the health rules read, so
 * an incident ends where the verdict would come back.
 */
const INCIDENT_GAP_MS = HEALTH_THRESHOLDS.windowMinutes * MS_PER_MINUTE;

/** One incident of one route: a run of 5xx without a long enough pause. */
export interface Incident {
  key: string;
  route: string;
  start: Date;
  /** Its last 5xx. */
  end: Date;
  /** No pause long enough to close it yet. */
  ongoing: boolean;
  serverErrors: number;
  /** Most 5xx answered within one minute. */
  peakPerMinute: number;
  topError: { status: number; message: string | null; count: number };
}

function incidentOf(
  key: string,
  route: string,
  errors: RequestLogSample[],
  now: number,
): Incident {
  const perMinute = new Map<number, number>();
  const groups = new Map<
    string,
    { status: number; message: string | null; count: number }
  >();
  for (const sample of errors) {
    const minute = Math.floor(
      new Date(sample.timestamp).getTime() / MS_PER_MINUTE,
    );
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
    const message = sample.errorMessage ?? null;
    const groupKey = `${sample.statusCode}|${message ?? ""}`;
    const group = groups.get(groupKey) ?? {
      status: sample.statusCode,
      message,
      count: 0,
    };
    group.count += 1;
    groups.set(groupKey, group);
  }
  const start = new Date(errors[0].timestamp);
  const end = new Date(errors[errors.length - 1].timestamp);
  return {
    key,
    route,
    start,
    end,
    ongoing: now - end.getTime() < INCIDENT_GAP_MS,
    serverErrors: errors.length,
    peakPerMinute: Math.max(...perMinute.values()),
    topError: [...groups.values()].reduce((top, group) =>
      group.count > top.count ? group : top,
    ),
  };
}

/**
 * Split the 5xx of `samples` into incidents: per route, a new incident
 * starts after {@link INCIDENT_GAP_MS} without a 5xx. Newest first.
 */
export function findIncidents(
  samples: RequestLogSample[],
  now: number,
): Incident[] {
  const byRoute = new Map<string, RequestLogSample[]>();
  for (const sample of samples) {
    if (sample.statusCode < 500) continue;
    const key = scopeRouteKey(sample.method, sample.uri);
    const errors = byRoute.get(key);
    if (errors) errors.push(sample);
    else byRoute.set(key, [sample]);
  }
  const incidents: Incident[] = [];
  for (const [key, errors] of byRoute) {
    const sorted = errors.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const route = routeRef(sorted[0].method, sorted[0].uri);
    let run: RequestLogSample[] = [];
    for (const sample of sorted) {
      const previous = run[run.length - 1];
      if (
        previous &&
        new Date(sample.timestamp).getTime() -
          new Date(previous.timestamp).getTime() >=
          INCIDENT_GAP_MS
      ) {
        incidents.push(incidentOf(key, route, run, now));
        run = [];
      }
      run.push(sample);
    }
    if (run.length > 0) incidents.push(incidentOf(key, route, run, now));
  }
  return incidents.sort((a, b) => b.start.getTime() - a.start.getTime());
}

/** The narrowest preset still holding `since`, for the logs to open on. */
function windowFor(since: Date, now: number): WindowPreset {
  const age = now - since.getTime();
  if (age <= 60 * MS_PER_MINUTE) return "1h";
  return age <= MS_PER_DAY ? "24h" : "7d";
}

/** One journal entry per incident, and its numbers. */
export interface IncidentItem extends FeedItemPayload {
  incident: {
    route: string;
    /** Its first 5xx. */
    start: string;
    /** Its last 5xx. */
    end: string;
    /**
     * When it closed: {@link INCIDENT_GAP_MS} after its last 5xx, when the
     * route's verdict comes back too. Null while it goes on.
     */
    endedAt: string | null;
    ongoing: boolean;
    durationMs: number;
    serverErrors: number;
    peakPerMinute: number;
    topError: { status: number; message: string | null; count: number };
  };
}

function floorMinute(at: number): Date {
  return new Date(Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE);
}

/**
 * The incident's 5xx in the logs: its route, over whole minutes from its
 * first 5xx to its last (the next 5xx of the route is at least
 * {@link INCIDENT_GAP_MS} away), within the narrowest window holding it.
 */
function incidentLink(incident: Incident, now: number): string {
  return logsLink({
    route: incident.route,
    tab: "5xx",
    window: windowFor(incident.start, now),
    since: floorMinute(incident.start.getTime()),
    until: floorMinute(incident.end.getTime() + MS_PER_MINUTE),
    from: "overview",
  });
}

function incidentItem(incident: Incident, now: number): IncidentItem {
  const durationMs = incident.end.getTime() - incident.start.getTime();
  const endedAt = incident.ongoing
    ? null
    : new Date(incident.end.getTime() + INCIDENT_GAP_MS).toISOString();
  const { topError } = incident;
  return {
    id: `incident:${incident.key}:${incident.start.getTime()}`,
    icon: incident.ongoing ? "i-ph-x-circle" : "i-ph-check-circle",
    tone: incident.ongoing ? "error" : "neutral",
    title: "$api.overview.activity.incident",
    meta: [
      "$api.overview.activity.incident_detail",
      incident.ongoing
        ? "$api.overview.activity.incident_ongoing"
        : "$api.overview.activity.incident_span",
      ...(topError.message
        ? ["$api.overview.activity.incident_top_error"]
        : []),
    ],
    params: {
      route: incident.route,
      count: String(incident.serverErrors),
      status: String(topError.status),
      message: topError.message ?? "",
      topStatus: String(topError.status),
      topMessage: topError.message ?? "",
      topCount: String(topError.count),
      start: incident.start.toISOString(),
      end: incident.end.toISOString(),
      endedAt: endedAt ?? "",
      minutes: String(Math.max(1, Math.round(durationMs / MS_PER_MINUTE))),
      peak: String(incident.peakPerMinute),
    },
    date: incident.start.toISOString(),
    to: incidentLink(incident, now),
    incident: {
      route: incident.route,
      start: incident.start.toISOString(),
      end: incident.end.toISOString(),
      endedAt,
      ongoing: incident.ongoing,
      durationMs,
      serverErrors: incident.serverErrors,
      peakPerMinute: incident.peakPerMinute,
      topError,
    },
  };
}

const DAY_KEY_LENGTH = 10;

function registeredItem(route: Route): FeedItemPayload {
  const ref = routeRef(route.method, route.uri);
  return {
    id: `route:${route._id}`,
    icon: "i-ph-plus-circle",
    tone: "success",
    title: "$api.overview.activity.registered",
    meta: [
      route.own
        ? "$api.overview.activity.from_project"
        : "$api.overview.activity.from_module",
    ],
    params: { route: ref, module: route.module ?? "" },
    date: route.createdAt.toISOString(),
    to: routeLink(ref),
  };
}

/**
 * Routes registered lately: one entry per route, or one per day when a day
 * registered several (a first start registers every route at once).
 */
async function registeredItems(
  models: ActivityModels,
  keys: ScopeKeys,
  since: Date,
): Promise<FeedItemPayload[]> {
  const routes = (await models.routes.getAll()).filter(
    (route) =>
      route.createdAt >= since &&
      (!keys || keys.has(scopeRouteKey(route.method, route.uri))),
  );
  const byDay = new Map<string, Route[]>();
  for (const route of routes) {
    const day = route.createdAt.toISOString().slice(0, DAY_KEY_LENGTH);
    byDay.set(day, [...(byDay.get(day) ?? []), route]);
  }
  return [...byDay].map(([day, group]) => {
    if (group.length === 1) return registeredItem(group[0]);
    const latest = group.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    return {
      id: `routes:${day}`,
      icon: "i-ph-plus-circle",
      tone: "success" as const,
      title: "$api.overview.activity.registered_many",
      meta: ["$api.overview.activity.registered_many_detail"],
      params: {
        count: String(group.length),
        routes: group
          .slice(0, 3)
          .map((route) => routeRef(route.method, route.uri))
          .join(", "),
      },
      date: latest.createdAt.toISOString(),
      to: routesLink(),
    };
  });
}

/**
 * The incident journal of the last 7 days: one entry per incident (start,
 * end, peak, top error), and the routes registered meanwhile, newest first.
 */
export async function getActivity(
  models: ActivityModels,
  keys: ScopeKeys,
  now: Date = new Date(),
): Promise<{
  items: FeedItemPayload[];
  window: { preset: WindowPreset; from: string; to: string };
}> {
  const range: TimeRange = presetRange(ACTIVITY_WINDOW, pinnedNow(now));
  const at = range.to.getTime();
  const errors = await loadErrorSamples(models.logs, range, keys, 500);
  // Newest first: only the first ones can make the journal, however many
  // incidents a trickle of 5xx made over the week.
  const items = [
    ...findIncidents(errors, at)
      .slice(0, ACTIVITY_LIMIT)
      .map((incident) => incidentItem(incident, at)),
    ...(await registeredItems(models, keys, range.from)),
  ]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, ACTIVITY_LIMIT);
  return {
    items,
    window: {
      preset: ACTIVITY_WINDOW,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
  };
}
