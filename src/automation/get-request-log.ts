import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel } from "@/db";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";
import { isRegisteredRoute } from "@/services/route-catalog";
import { REQUEST_ID_MAX_LENGTH } from "@/types";
import {
  nullable,
  objectSchema,
  REQUEST_SUMMARY_PROPERTIES,
  type RequestSummary,
  requestSummary,
} from "./outputs";

interface GetRequestLogInput {
  id?: string;
  requestId?: string;
}

type RequestLogOutput = RequestSummary & {
  routeRegistered: boolean;
  responseBodySize: number | null;
};

type GetRequestLogOutput = {
  found: boolean;
  log: RequestLogOutput | null;
  matches: number;
};

/** Most rows sharing one `x-request-id` read, and counted. */
const MAX_MATCHES = 50;

function logOutput(row: RequestLogSummaryRow): RequestLogOutput {
  const summary = requestSummary(row);
  return {
    ...summary,
    routeRegistered: summary.route !== null && isRegisteredRoute(summary.route),
    responseBodySize: row.responseBodySize ?? null,
  };
}

/** The newest row and how many there are: what a read by id or request id answers. */
export function requestLogAnswer(
  rows: RequestLogSummaryRow[],
): GetRequestLogOutput {
  const [newest] = rows;
  return {
    found: newest !== undefined,
    log: newest ? logOutput(newest) : null,
    matches: rows.length,
  };
}

/** The summary reads of the request logs. */
export type RequestLogReader = Pick<
  RequestLogModel,
  "summaryById" | "querySummary"
>;

const SOURCES = (): RequestLogReader => GetModel(RequestLogModel);

/** The action, reading through `sources`. */
export function getRequestLogActionOf(
  sources: () => RequestLogReader = SOURCES,
): ActionType<GetRequestLogInput, GetRequestLogOutput> {
  return {
    id: "api.get-request-log",
    name: "Get request log",
    description:
      "One captured request by its log id or its x-request-id, as a summary (support flow)",
    icon: "i-ph-receipt",
    sideEffects: false,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", maxLength: 200, description: "Log id" },
        requestId: {
          type: "string",
          maxLength: REQUEST_ID_MAX_LENGTH,
          description: "x-request-id; the newest request when several share it",
        },
      },
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      found: { type: "boolean" },
      log: nullable(
        "object",
        objectSchema({
          ...REQUEST_SUMMARY_PROPERTIES,
          routeRegistered: {
            type: "boolean",
            description: "A route still answers it",
          },
          responseBodySize: nullable("integer"),
        }),
      ),
      matches: {
        type: "integer",
        description: `Requests found, at most ${MAX_MATCHES}`,
      },
    }),
    async execute(input) {
      const model = sources();
      if (input.id) {
        const row = await model.summaryById(input.id);
        return requestLogAnswer(row ? [row] : []);
      }
      if (input.requestId) {
        const page = await model.querySummary({
          requestId: input.requestId,
          limit: MAX_MATCHES,
        });
        return requestLogAnswer(page.results);
      }
      throw new Error("Give the request's log id or its x-request-id");
    },
  };
}

export const getRequestLogAction = getRequestLogActionOf();
