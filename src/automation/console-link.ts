import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import {
  logsLink,
  overviewLink,
  requestLink,
  ROUTE_TABS,
  routeLink,
  routesLink,
  settingsLink,
  type StatusTab,
  testerLink,
} from "@/services/links";
import { parseRouteRef } from "@/services/route-catalog";
import { isWindowPreset, type WindowPreset } from "@/services/window";
import {
  DATE_TIME,
  MESSAGE_MAX_LENGTH,
  nullable,
  objectSchema,
  PERIOD_INPUT,
  routeRefInput,
} from "./outputs";

type ConsoleTarget =
  | "overview"
  | "route"
  | "tester"
  | "request"
  | "logs"
  | "routes"
  | "settings";

interface ConsoleLinkInput {
  target: ConsoleTarget;
  route?: string;
  tab?: keyof typeof ROUTE_TABS;
  requestLogId?: string;
  statusTab?: StatusTab;
  error?: string;
  requestId?: string;
  since?: string;
  until?: string;
  period?: WindowPreset;
}

type ConsoleLinkOutput = {
  path: string;
  url: string | null;
  valid: boolean;
};

let dashboardOrigin: string | null = null;

/** The dashboard origin absolute links are built on; null leaves `url` null. */
export function setDashboardOrigin(origin: string | null | undefined): void {
  const trimmed = origin?.trim().replace(/\/+$/, "");
  dashboardOrigin = trimmed || null;
}

function dateOf(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The path a target names, or null when an input it needs is missing. */
function targetPath(input: ConsoleLinkInput): string | null {
  const period = isWindowPreset(input.period) ? input.period : null;
  const parsed = parseRouteRef(input.route);
  const route = parsed ? `${parsed.method} ${parsed.path}` : undefined;
  switch (input.target) {
    case "overview":
      return overviewLink(period);
    case "route":
      return route
        ? routeLink(
            route,
            input.tab ? ROUTE_TABS[input.tab] : undefined,
            period,
          )
        : null;
    case "tester":
      return route ? testerLink(route) : null;
    case "request":
      return input.requestLogId ? requestLink(input.requestLogId) : null;
    case "logs": {
      const since = dateOf(input.since);
      const until = dateOf(input.until);
      return logsLink({
        route,
        tab: input.statusTab,
        error: input.error,
        requestId: input.requestId,
        period,
        range: since || until ? { from: since, to: until } : undefined,
      });
    }
    case "routes":
      return routesLink();
    case "settings":
      return settingsLink();
    default:
      return null;
  }
}

/** The page root a target falls back to when its input is missing. */
function rootOf(target: ConsoleTarget): string {
  if (target === "route" || target === "tester") return routesLink();
  if (target === "request") return logsLink();
  return overviewLink();
}

export function consoleLink(input: ConsoleLinkInput): ConsoleLinkOutput {
  let path: string | null;
  try {
    path = targetPath(input);
  } catch {
    path = null;
  }
  const resolved = path ?? rootOf(input.target);
  return {
    path: resolved,
    url: dashboardOrigin ? `${dashboardOrigin}${resolved}` : null,
    valid: path !== null,
  };
}

export const consoleLinkData: DataNodeType<
  ConsoleLinkInput,
  ConsoleLinkOutput
> = {
  id: "api.console-link",
  category: "api",
  name: "API console link",
  description:
    "Path and URL of an API console page: a route, a request, the logs of a route or a time range, the Overview",
  icon: "i-ph-link",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: [
          "overview",
          "route",
          "tester",
          "request",
          "logs",
          "routes",
          "settings",
        ],
      },
      route: routeRefInput("For route, tester and logs"),
      tab: {
        type: "string",
        enum: Object.keys(ROUTE_TABS),
        description: "For route",
      },
      requestLogId: {
        type: "string",
        maxLength: 200,
        description: "For request",
      },
      statusTab: {
        type: "string",
        enum: ["2xx", "4xx", "5xx"],
        description: "For logs",
      },
      error: {
        type: "string",
        maxLength: MESSAGE_MAX_LENGTH,
        description: "For logs",
      },
      requestId: { type: "string", maxLength: 128, description: "For logs" },
      since: { ...DATE_TIME, description: "For logs" },
      until: { ...DATE_TIME, description: "For logs" },
      period: {
        ...PERIOD_INPUT,
        description: "For logs, route and overview",
      },
    },
    required: ["target"],
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    path: { type: "string", description: "Relative console path" },
    url: nullable("string", {
      description: "Absolute when the dashboard origin is known",
    }),
    valid: {
      type: "boolean",
      description:
        "False when the target's required input is missing: path is then the page root",
    },
  }),
  evaluate: consoleLink,
};
