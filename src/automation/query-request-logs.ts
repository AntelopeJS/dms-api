import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import {
  REQUEST_LOG_MAX_LIMIT,
  type RequestLogStatusClass,
} from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { queryRequestLogsScoped } from "@/services/request-log/read";
import { activeScopeKeys } from "./scope";

interface QueryRequestLogsInput {
  routeId?: string;
  uri?: string;
  method?: string;
  statusClass?: RequestLogStatusClass;
  statusMin?: number;
  statusMax?: number;
  limit?: number;
}

interface QueryRequestLogsOutput {
  results: RequestLog[];
  nextCursor?: string;
}

export const queryRequestLogsAction: ActionType<
  QueryRequestLogsInput,
  QueryRequestLogsOutput
> = {
  id: "api.query-request-logs",
  name: "Query request logs",
  description: "Query captured API request logs under the active route scope",
  icon: "i-ph-list-magnifying-glass",
  inputSchema: {
    type: "object",
    properties: {
      routeId: { type: "string" },
      uri: { type: "string" },
      method: { type: "string" },
      statusClass: {
        type: "string",
        enum: ["success", "client-error", "server-error"],
      },
      statusMin: { type: "number" },
      statusMax: { type: "number" },
      // Declared, not silent: the model clamps a page to MAX_LIMIT. Ask for
      // more rows than that by following `nextCursor`.
      limit: { type: "number", default: 50, maximum: REQUEST_LOG_MAX_LIMIT },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      results: { type: "array", items: { type: "object" } },
      nextCursor: { type: "string" },
    },
  },
  async execute(input) {
    const keys = await activeScopeKeys();
    const page = await queryRequestLogsScoped(
      GetModel(RequestLogModel),
      {
        routeId: input.routeId,
        uri: input.uri,
        method: input.method,
        statusClass: input.statusClass,
        statusMin: input.statusMin,
        statusMax: input.statusMax,
        limit: input.limit,
      },
      keys,
    );
    return { results: page.results, nextCursor: page.nextCursor ?? undefined };
  },
};
