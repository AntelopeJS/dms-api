import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import { logsLink } from "@/services/links";
import type { ErrorGroup } from "@/services/route-health";
import { routeErrorGroups } from "@/services/route-statistics";
import type { TimeWindow, WindowPreset } from "@/services/window";
import { inputWindow } from "./get-route-statistics";
import {
  DATE_TIME,
  nullable,
  objectSchema,
  PERIOD_INPUT,
  requireRouteRef,
  routeRefInput,
  truncateMessage,
} from "./outputs";
import { refreshSettings } from "./scope";

type ErrorClass = "client-error" | "server-error" | "any";

interface GetRouteErrorsInput {
  route: string;
  period?: WindowPreset;
  since?: string;
  until?: string;
  statusClass?: ErrorClass;
  limit?: number;
}

type ErrorGroupOutput = {
  status: number;
  message: string | null;
  count: number;
  first: string;
  last: string;
  logsPath: string;
};

type GetRouteErrorsOutput = {
  errors: ErrorGroupOutput[];
  totalGroups: number;
  from: string;
  to: string;
};

const DEFAULT_PERIOD: WindowPreset = "last-24h";
const DEFAULT_LIMIT = 10;
const SERVER_ERROR = 500;

function inClass(group: ErrorGroup, statusClass: ErrorClass): boolean {
  if (statusClass === "server-error") return group.status >= SERVER_ERROR;
  if (statusClass === "client-error") return group.status < SERVER_ERROR;
  return true;
}

export function errorGroupOutput(
  group: ErrorGroup,
  ref: string,
  window: TimeWindow,
): ErrorGroupOutput {
  return {
    status: group.status,
    message: truncateMessage(group.message),
    count: group.count,
    first: group.first.toISOString(),
    last: group.last.toISOString(),
    logsPath: logsLink({
      route: ref,
      error: group.message ?? undefined,
      tab: group.status >= SERVER_ERROR ? "5xx" : "4xx",
      period: window.preset,
      range: window.preset ? undefined : window,
    }),
  };
}

export const getRouteErrorsAction: ActionType<
  GetRouteErrorsInput,
  GetRouteErrorsOutput
> = {
  id: "api.get-route-errors",
  name: "Get route errors",
  description:
    "A route's errors over a period, grouped by status and message, most frequent first",
  icon: "i-ph-warning-diamond",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      route: routeRefInput("METHOD /path of the route"),
      period: {
        ...PERIOD_INPUT,
        default: DEFAULT_PERIOD,
        description: "Ignored when since is set",
      },
      since: DATE_TIME,
      until: { ...DATE_TIME, description: "Now by default" },
      statusClass: {
        type: "string",
        enum: ["client-error", "server-error", "any"],
        default: "any",
      },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["route"],
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    errors: {
      type: "array",
      items: objectSchema({
        status: { type: "integer" },
        message: nullable("string"),
        count: { type: "integer" },
        first: DATE_TIME,
        last: DATE_TIME,
        logsPath: { type: "string" },
      }),
    },
    totalGroups: { type: "integer", description: "Before the limit" },
    from: DATE_TIME,
    to: DATE_TIME,
  }),
  async execute(input) {
    const route = requireRouteRef(input.route);
    await refreshSettings();
    const window = inputWindow({ ...input, compare: false }, DEFAULT_PERIOD);
    const groups = (
      await routeErrorGroups({ logs: GetModel(RequestLogModel) }, route, window)
    ).filter((group) => inClass(group, input.statusClass ?? "any"));
    return {
      errors: groups
        .slice(0, input.limit ?? DEFAULT_LIMIT)
        .map((group) => errorGroupOutput(group, route.ref, window)),
      totalGroups: groups.length,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
  },
};
