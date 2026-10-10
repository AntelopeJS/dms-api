import type { Route } from "@/db/tables/routes.table";
import { MS_PER_DAY } from "@/types";
import { logsLink, routeLink, routeRef, routesLink } from "./links";
import type { FeedItemPayload, OverviewModels } from "./overview";
import { computeRouteHealth, type RouteHealth } from "./route-health";
import { loadSamples, type ScopeKeys } from "./traffic";

const ACTIVITY_LIMIT = 8;
const ACTIVITY_WINDOW_MS = 7 * MS_PER_DAY;

function incidentItems(health: RouteHealth[]): FeedItemPayload[] {
  return health
    .filter((route) => route.traffic.serverErrors > 0)
    .map((route) => {
      const errors = route.errors.filter((group) => group.status >= 500);
      const last = errors.reduce(
        (newest, group) => (group.last > newest ? group.last : newest),
        errors[0].last,
      );
      const ref = routeRef(route.method, route.uri);
      return {
        id: `incident:${route.key}`,
        icon: "i-ph-x-circle",
        tone: "error" as const,
        title: "$api.overview.activity.incident",
        meta: ["$api.overview.activity.incident_detail"],
        params: {
          route: ref,
          count: String(route.traffic.serverErrors),
          status: String(errors[0].status),
        },
        date: last.toISOString(),
        to: logsLink({ route: ref, tab: "5xx" }),
      };
    });
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
  models: OverviewModels,
  keys: ScopeKeys,
  since: Date,
): Promise<FeedItemPayload[]> {
  const routes = (await models.routes.getAll()).filter(
    (route) =>
      route.createdAt >= since &&
      (!keys || keys.has(`${route.method.toUpperCase()}:${route.uri}`)),
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
 * What changed lately: incidents (server errors per route) and newly
 * registered routes, newest first.
 */
export async function getActivity(
  models: OverviewModels,
  keys: ScopeKeys,
  now: Date = new Date(),
): Promise<{ items: FeedItemPayload[] }> {
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_MS);
  const samples = await loadSamples(
    models.logs,
    { from: since, to: now },
    keys,
  );
  const health = [...computeRouteHealth(samples).values()];
  const items = [
    ...incidentItems(health),
    ...(await registeredItems(models, keys, since)),
  ]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, ACTIVITY_LIMIT);
  return { items };
}
