import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel, RouteModel } from "@/db";
import { routeLink } from "@/services/links";
import {
  authOf,
  findRoute,
  listRoutes,
  type RouteRow,
} from "@/services/route-catalog";
import { routeStates } from "@/services/route-state";
import { type RouteScope, scopeRouteKey } from "@/services/scope";
import { MS_PER_DAY } from "@/types";
import {
  HTTP_METHODS,
  nullable,
  objectSchema,
  PATH_PREFIX_INPUT,
} from "./outputs";
import { activeScopeKeys } from "./scope";

interface ListRoutesInput {
  scope?: "active" | RouteScope;
  pathPrefix?: string;
  methods?: string[];
  includeAuth?: boolean;
  limit?: number;
  offset?: number;
}

type ListedRoute = {
  route: string;
  method: string;
  path: string;
  folder: string;
  module: string | null;
  own: boolean | null;
  controller: string | null;
  handler: string;
  state: string;
  requests24h: number;
  lastCallAt: string | null;
  authStatus: string | null;
  authGuards: string[] | null;
  routePath: string;
};

type ListRoutesOutput = {
  routes: ListedRoute[];
  total: number;
  nextOffset: number | null;
};

const DEFAULT_LIMIT = 100;
const UNAUTHORIZED = 401;
const UNAUTHORIZED_WINDOW_DAYS = 7;

/** The rows an input keeps, in the tree's order. */
export function filterRoutes(
  rows: RouteRow[],
  input: Pick<ListRoutesInput, "pathPrefix" | "methods">,
): RouteRow[] {
  const methods = input.methods?.length
    ? new Set(input.methods.map((method) => method.toUpperCase()))
    : null;
  const prefix = input.pathPrefix?.replace(/\/+$/, "");
  return rows.filter(
    (row) =>
      (!methods || methods.has(row.method)) &&
      (!prefix || row.path === prefix || row.path.startsWith(`${prefix}/`)),
  );
}

async function unauthorizedCounts(): Promise<Map<string, number>> {
  const counts = await GetModel(RequestLogModel).statusCounts({
    statusMin: UNAUTHORIZED,
    statusMax: UNAUTHORIZED,
    since: new Date(Date.now() - UNAUTHORIZED_WINDOW_DAYS * MS_PER_DAY),
  });
  const byRoute = new Map<string, number>();
  for (const count of counts) {
    const key = scopeRouteKey(count.method, count.uri);
    byRoute.set(key, (byRoute.get(key) ?? 0) + count.requests);
  }
  return byRoute;
}

export const listRoutesAction: ActionType<ListRoutesInput, ListRoutesOutput> = {
  id: "api.list-routes",
  name: "List routes",
  description:
    "Registered API routes with their owner module and 24-hour state, for audits",
  icon: "i-ph-tree-structure",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["active", "own", "modules", "all"],
        default: "active",
        description: "active: the console's scope setting",
      },
      pathPrefix: PATH_PREFIX_INPUT,
      methods: {
        type: "array",
        items: { type: "string", enum: [...HTTP_METHODS] },
        uniqueItems: true,
      },
      includeAuth: {
        type: "boolean",
        default: false,
        description:
          "Adds authStatus and authGuards; inspects each handler's source, slower",
      },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        minimum: 1,
        maximum: 500,
      },
      offset: { type: "integer", default: 0, minimum: 0 },
    },
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    routes: {
      type: "array",
      items: objectSchema({
        route: { type: "string" },
        method: { type: "string" },
        path: { type: "string" },
        folder: { type: "string" },
        module: nullable("string"),
        own: nullable("boolean"),
        controller: nullable("string"),
        handler: { type: "string" },
        state: {
          type: "string",
          enum: [
            "failing",
            "slow",
            "client-errors",
            "recovered",
            "healthy",
            "idle",
          ],
        },
        requests24h: { type: "integer" },
        lastCallAt: nullable("string", { format: "date-time" }),
        authStatus: nullable("string", {
          enum: ["required", "probable", "unknown", null],
        }),
        authGuards: nullable("array", { items: { type: "string" } }),
        routePath: { type: "string" },
      }),
    },
    total: { type: "integer", description: "After the filters" },
    nextOffset: nullable("integer"),
  }),
  async execute(input) {
    const keys = await activeScopeKeys(
      input.scope === "active" ? undefined : input.scope,
    );
    const rows = filterRoutes(listRoutes(keys), input);
    const offset = input.offset ?? 0;
    const page = rows.slice(offset, offset + (input.limit ?? DEFAULT_LIMIT));
    const [stored, states, unauthorized] = await Promise.all([
      GetModel(RouteModel).getAll(),
      routeStates(),
      input.includeAuth ? unauthorizedCounts() : undefined,
    ]);
    const own = new Map(
      stored.map((route) => [scopeRouteKey(route.method, route.uri), route]),
    );
    const routes = page.map((row): ListedRoute => {
      const key = scopeRouteKey(row.method, row.path);
      const state = states.of(row.method, row.path);
      const inspection = unauthorized ? findRoute(row.ref) : undefined;
      const auth = inspection
        ? authOf(inspection, [
            { status: UNAUTHORIZED, count: unauthorized?.get(key) ?? 0 },
          ])
        : undefined;
      return {
        route: row.ref,
        method: row.method,
        path: row.path,
        folder: row.folder,
        module: row.module ?? own.get(key)?.module ?? null,
        own: own.get(key)?.own ?? null,
        controller: row.controller,
        handler: row.handler,
        state: state.state,
        requests24h: state.requests,
        lastCallAt: state.lastCallAt,
        authStatus: auth?.status ?? null,
        authGuards: auth?.guards ?? null,
        routePath: routeLink(row.ref),
      };
    });
    const end = offset + page.length;
    return {
      routes,
      total: rows.length,
      nextOffset: end < rows.length ? end : null,
    };
  },
};
