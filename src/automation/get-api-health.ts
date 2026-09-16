import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RouteStatisticsModel } from "@/db";
import {
  getStatusBreakdown,
  getSummaryKpis,
  type StatusBreakdown,
  type SummaryKpis,
} from "@/services/statistics-aggregate";
import { activeScopeKeys, countScopedRoutes } from "./scope";

interface GetApiHealthInput {
  days?: number;
}

interface GetApiHealthOutput extends SummaryKpis {
  statusBreakdown: StatusBreakdown;
}

export const getApiHealthAction: ActionType<
  GetApiHealthInput,
  GetApiHealthOutput
> = {
  id: "api.get-api-health",
  name: "Get API health",
  description:
    "Summary KPIs and status breakdown for the routes under the active scope",
  icon: "i-ph-heartbeat",
  inputSchema: {
    type: "object",
    properties: {
      days: {
        type: "number",
        title: "Breakdown window (days)",
        description:
          "Restrict the status breakdown to the last N days; omit for all retained data. KPIs always cover their fixed windows (24h / today / all).",
        minimum: 1,
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      totalRoutes: { type: "number" },
      routesWithErrors24h: { type: "number" },
      slowRoutesCount: { type: "number" },
      averageLatencyMs: { type: "number" },
      callsToday: { type: "number" },
      errors24h: { type: "number" },
      statusBreakdown: {
        type: "object",
        properties: {
          success: { type: "number" },
          clientErrors: { type: "number" },
          serverErrors: { type: "number" },
          total: { type: "number" },
        },
      },
    },
  },
  async execute(input) {
    const keys = await activeScopeKeys();
    const totalRoutes = await countScopedRoutes(keys);
    const statsModel = GetModel(RouteStatisticsModel);
    const kpis = await getSummaryKpis(statsModel, totalRoutes, keys);
    const statusBreakdown = await getStatusBreakdown(
      statsModel,
      input.days,
      keys,
    );
    return { ...kpis, statusBreakdown };
  },
};
