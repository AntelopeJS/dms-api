import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel, RouteStatisticsModel } from "@/db";
import { currentHealth } from "@/services/overview";
import { countRoutes } from "@/services/route-catalog";
import { getActiveScope } from "@/services/settings";
import {
  getStatusBreakdown,
  getSummaryKpis,
  type StatusBreakdown,
  type SummaryKpis,
} from "@/services/statistics-aggregate";
import {
  HEALTH_OUTPUT_PROPERTIES,
  type HealthOutput,
  healthOutput,
} from "./health-output";
import { objectSchema } from "./outputs";
import { activeScopeKeys } from "./scope";

interface GetApiHealthInput {
  days?: number;
}

type GetApiHealthOutput = SummaryKpis & {
  statusBreakdown: StatusBreakdown;
} & HealthOutput;

const MAX_BREAKDOWN_DAYS = 90;

export const getApiHealthAction: ActionType<
  GetApiHealthInput,
  GetApiHealthOutput
> = {
  id: "api.get-api-health",
  name: "Get API health",
  description:
    "The API's health verdict, its current or last incident, the 15-minute rates and the day KPIs of the routes in the active scope",
  icon: "i-ph-heartbeat",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      days: {
        type: "integer",
        title: "Breakdown window (days)",
        description:
          "Restrict the status breakdown to the last N calendar days; omit for all retained data. The other figures keep their own windows.",
        minimum: 1,
        maximum: MAX_BREAKDOWN_DAYS,
      },
    },
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    totalRoutes: { type: "number", description: "Registered routes in scope" },
    failingRoutes: { type: "number" },
    slowRoutesCount: { type: "number" },
    averageLatencyMs: {
      type: "number",
      description: "Mean over every retained day, not the last 24 h",
    },
    callsToday: { type: "number", description: "Current calendar day" },
    errors24h: {
      type: "number",
      description: "4xx and 5xx of yesterday and today, by calendar day",
    },
    statusBreakdown: objectSchema({
      success: { type: "number" },
      clientErrors: { type: "number" },
      serverErrors: { type: "number" },
      total: { type: "number" },
    }),
    ...HEALTH_OUTPUT_PROPERTIES,
  }),
  async execute(input) {
    const keys = await activeScopeKeys();
    const statsModel = GetModel(RouteStatisticsModel);
    const [kpis, statusBreakdown, health] = await Promise.all([
      getSummaryKpis(
        { logs: GetModel(RequestLogModel), stats: statsModel },
        countRoutes(keys),
        keys,
      ),
      getStatusBreakdown(statsModel, input.days, keys),
      currentHealth(),
    ]);
    return {
      ...kpis,
      statusBreakdown,
      ...healthOutput(health, getActiveScope()),
    };
  },
};
