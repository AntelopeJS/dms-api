import type {
  ActionType,
  ExecutionCtx,
  JsonValue,
} from "@antelopejs/interface-dms-automation";
import { apiOrigin } from "@/services/api-origin";
import {
  callRequestId,
  type OriginReader,
  prepareRouteCall,
  ROUTE_CALL_LIMITS,
  type RouteCallInput,
  sendRouteCall,
} from "@/services/route-call";
import { nullable, objectSchema, routeRefInput } from "./outputs";
import { refreshSettings } from "./scope";

type CallRouteInput = RouteCallInput & { body?: JsonValue };

type CallRouteOutput = {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  contentType: string | null;
  body: JsonValue;
  bodyTruncated: boolean;
  requestId: string;
  logsPath: string;
  dryRun: boolean;
};

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(isJsonValue);
}

/** What the action reads and calls through. */
export interface CallRouteSources {
  refresh: () => Promise<void>;
  origin: OriginReader;
  send: typeof fetch;
}

const SOURCES: CallRouteSources = {
  refresh: refreshSettings,
  origin: apiOrigin,
  send: (url, init) => fetch(url, init),
};

/** The action, reading the settings and the origin and calling through `sources`. */
export function callRouteActionOf(
  sources: CallRouteSources = SOURCES,
): ActionType<CallRouteInput, CallRouteOutput> {
  const prepare = async (input: CallRouteInput, ctx: ExecutionCtx) => {
    await sources.refresh();
    return prepareRouteCall(
      input,
      callRequestId(ctx.runId, ctx.nodeId),
      sources.origin,
    );
  };
  return {
    id: "api.call-route",
    name: "Call API route",
    description:
      "Calls a registered route of this API over HTTP, for synthetic checks. The call is logged as an automation call and kept out of the statistics and the health",
    icon: "i-ph-paper-plane-tilt",
    inputSchema: {
      type: "object",
      properties: {
        route: routeRefInput("METHOD /path of a registered route"),
        pathParams: {
          type: "object",
          title: "Path parameters",
          description: "Values of the :name segments",
          additionalProperties: { type: "string", maxLength: 512 },
          maxProperties: 20,
          default: {},
        },
        query: {
          type: "object",
          title: "Query",
          additionalProperties: {
            anyOf: [
              { type: "string", maxLength: 2048 },
              { type: "array", items: { type: "string", maxLength: 2048 } },
            ],
          },
          maxProperties: 50,
          default: {},
        },
        body: {
          title: "JSON body",
          description: `At most ${ROUTE_CALL_LIMITS.bodyBytes} bytes; refused on GET and HEAD`,
        },
        credential: {
          type: "string",
          title: "Credential profile",
          description:
            "A profile of the dms-api automationCredentials configuration; anonymous when empty",
          maxLength: 100,
        },
        timeoutMs: {
          type: "integer",
          default: ROUTE_CALL_LIMITS.defaultTimeoutMs,
          minimum: 100,
          maximum: 30_000,
        },
        includeBody: {
          type: "boolean",
          default: false,
          description: `Return the response body, cut at ${ROUTE_CALL_LIMITS.responseChars} characters`,
        },
      },
      required: ["route"],
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      ok: { type: "boolean", description: "Status 200-399" },
      statusCode: nullable("integer", {
        description: "Null on a timeout or a network error",
      }),
      durationMs: { type: "number" },
      error: nullable("string", {
        description: "The timeout or network error",
      }),
      contentType: nullable("string"),
      body: {
        description: "With includeBody only; parsed when the type is JSON",
      },
      bodyTruncated: { type: "boolean" },
      requestId: { type: "string", description: "The x-request-id sent" },
      logsPath: { type: "string", description: "The call in the logs" },
      dryRun: { type: "boolean" },
    }),
    async dryRun(input, ctx) {
      const call = await prepare(input, ctx);
      return {
        ok: true,
        statusCode: 200,
        durationMs: 0,
        error: null,
        contentType: null,
        body: null,
        bodyTruncated: false,
        requestId: call.requestId,
        logsPath: call.logsPath,
        dryRun: true,
      };
    },
    async execute(input, ctx) {
      const call = await prepare(input, ctx);
      const result = await sendRouteCall(
        call,
        input.includeBody ?? false,
        sources.send,
      );
      return {
        ...result,
        body: isJsonValue(result.body) ? result.body : null,
        requestId: call.requestId,
        logsPath: call.logsPath,
        dryRun: false,
      };
    },
  };
}

export const callRouteAction = callRouteActionOf();
