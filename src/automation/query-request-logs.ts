import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import {
  REQUEST_LOG_MAX_LIMIT,
  type RequestLogFilters,
  type RequestLogStatusClass,
} from "@/db/models/request_log.model";
import { queryRequestSummariesScoped } from "@/services/request-log/read";
import { REQUEST_ID_MAX_LENGTH } from "@/types";
import {
  DATE_TIME,
  dateInput,
  HTTP_METHODS,
  nullable,
  objectSchema,
  REQUEST_SUMMARY_SCHEMA,
  type RequestSummary,
  requestSummary,
  requireRouteRef,
  routeRefInput,
} from "./outputs";
import { activeScopeKeys } from "./scope";

interface QueryRequestLogsInput {
  routeId?: string;
  route?: string;
  uri?: string;
  method?: string;
  statusClass?: RequestLogStatusClass;
  statusMin?: number;
  statusMax?: number;
  since?: string;
  until?: string;
  requestId?: string;
  errorMessage?: string;
  cursor?: string;
  limit?: number;
}

type QueryRequestLogsOutput = {
  results: RequestSummary[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;

/** The log filters an input names, unset ones left out. */
export function requestLogFilters(
  input: QueryRequestLogsInput,
): RequestLogFilters {
  const route = input.route ? requireRouteRef(input.route) : undefined;
  const filters: RequestLogFilters = {
    routeId: input.routeId,
    uri: route?.path ?? input.uri,
    routeMethod: route?.method,
    method: input.method,
    statusClass: input.statusClass,
    statusMin: input.statusMin,
    statusMax: input.statusMax,
    since: dateInput("since", input.since),
    until: dateInput("until", input.until),
    requestId: input.requestId,
    errorMessage: input.errorMessage,
    cursor: input.cursor,
    limit: input.limit ?? DEFAULT_LIMIT,
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  );
}

export const queryRequestLogsAction: ActionType<
  QueryRequestLogsInput,
  QueryRequestLogsOutput
> = {
  id: "api.query-request-logs",
  name: "Query request logs",
  description:
    "Search captured API requests under the active route scope; returns summary rows, never headers or bodies",
  icon: "i-ph-list-magnifying-glass",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      routeId: {
        type: "string",
        maxLength: 200,
        description: "Runtime route id (changes on every start; prefer route)",
      },
      route: routeRefInput("METHOD /path of the route the requests reached"),
      uri: { type: "string", maxLength: 2048, description: "Route pattern" },
      method: { type: "string", enum: [...HTTP_METHODS] },
      statusClass: {
        type: "string",
        enum: ["success", "client-error", "server-error"],
      },
      statusMin: { type: "integer", minimum: 100, maximum: 599 },
      statusMax: { type: "integer", minimum: 100, maximum: 599 },
      since: {
        ...DATE_TIME,
        description: "Inclusive; 30 days back by default under a scope",
      },
      until: { ...DATE_TIME, description: "Exclusive; now by default" },
      requestId: {
        type: "string",
        maxLength: REQUEST_ID_MAX_LENGTH,
        description: "x-request-id",
      },
      errorMessage: {
        type: "string",
        maxLength: 200,
        description: "Part of the error message, any case",
      },
      cursor: {
        type: "string",
        maxLength: 200,
        description: "nextCursor of the previous page",
      },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        minimum: 1,
        maximum: REQUEST_LOG_MAX_LIMIT,
      },
    },
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    results: { type: "array", items: REQUEST_SUMMARY_SCHEMA },
    nextCursor: nullable("string"),
  }),
  async execute(input) {
    const filters = requestLogFilters(input);
    const keys = await activeScopeKeys();
    const page = await queryRequestSummariesScoped(
      GetModel(RequestLogModel),
      filters,
      keys,
    );
    return {
      results: page.results.map(requestSummary),
      nextCursor: page.nextCursor,
    };
  },
};
