import { GetModel } from "@antelopejs/interface-database-decorators";
import type { ActionType } from "@antelopejs/interface-dms-automation";
import { RequestLogModel, RouteModel } from "@/db";
import { routeLink, testerLink } from "@/services/links";
import {
  type DeclaredParameter,
  getRouteFacts,
} from "@/services/route-catalog";
import { routeStates } from "@/services/route-state";
import { scopeRouteKey } from "@/services/scope";
import { nullable, objectSchema, routeRefInput, VERDICTS } from "./outputs";
import { activeScopeKeys } from "./scope";

interface GetRouteDetailInput {
  route: string;
}

type GetRouteDetailOutput = {
  found: boolean;
  route: string | null;
  method: string | null;
  path: string | null;
  folder: string | null;
  module: string | null;
  own: boolean | null;
  inScope: boolean | null;
  controller: string | null;
  handler: string | null;
  authStatus: string | null;
  authGuards: string[];
  unauthorized7d: number;
  parameters: DeclaredParameter[];
  state: string | null;
  verdict: string | null;
  requests24h: number;
  p95Ms: number | null;
  firstCallAt: string | null;
  lastCallAt: string | null;
  registeredAt: string | null;
  routePath: string | null;
  testerPath: string | null;
};

const NOT_FOUND: GetRouteDetailOutput = {
  found: false,
  route: null,
  method: null,
  path: null,
  folder: null,
  module: null,
  own: null,
  inScope: null,
  controller: null,
  handler: null,
  authStatus: null,
  authGuards: [],
  unauthorized7d: 0,
  parameters: [],
  state: null,
  verdict: null,
  requests24h: 0,
  p95Ms: null,
  firstCallAt: null,
  lastCallAt: null,
  registeredAt: null,
  routePath: null,
  testerPath: null,
};

export const getRouteDetailAction: ActionType<
  GetRouteDetailInput,
  GetRouteDetailOutput
> = {
  id: "api.get-route-detail",
  name: "Get route detail",
  description:
    "A route's method, path, owner module, authentication status, declared parameters and 24-hour state",
  icon: "i-ph-signpost",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      route: routeRefInput("METHOD /path of the route"),
    },
    required: ["route"],
    additionalProperties: false,
  },
  outputSchema: objectSchema({
    found: {
      type: "boolean",
      description: "False when no registered route answers the ref",
    },
    route: nullable("string"),
    method: nullable("string"),
    path: nullable("string"),
    folder: nullable("string"),
    module: nullable("string"),
    own: nullable("boolean"),
    inScope: nullable("boolean", {
      description: "Under the active scope",
    }),
    controller: nullable("string"),
    handler: nullable("string"),
    authStatus: nullable("string", {
      enum: ["required", "probable", "unknown", null],
    }),
    authGuards: { type: "array", items: { type: "string" } },
    unauthorized7d: {
      type: "integer",
      description: "401 answers over the last 7 days",
    },
    parameters: {
      type: "array",
      items: objectSchema({
        name: { type: "string" },
        in: { type: "string", enum: ["path", "query", "header"] },
        type: { type: "string" },
        required: { type: "boolean" },
      }),
    },
    state: nullable("string", {
      enum: [
        "failing",
        "slow",
        "client-errors",
        "recovered",
        "healthy",
        "idle",
        null,
      ],
    }),
    verdict: nullable("string", { enum: [...VERDICTS, null] }),
    requests24h: { type: "integer" },
    p95Ms: nullable("number"),
    firstCallAt: nullable("string", { format: "date-time" }),
    lastCallAt: nullable("string", { format: "date-time" }),
    registeredAt: nullable("string", { format: "date-time" }),
    routePath: nullable("string"),
    testerPath: nullable("string"),
  }),
  async execute(input) {
    const keys = await activeScopeKeys();
    const facts = await getRouteFacts(
      { logs: GetModel(RequestLogModel), routes: GetModel(RouteModel) },
      input.route,
    );
    if (!facts) return NOT_FOUND;
    const state = (await routeStates()).of(facts.method, facts.path);
    return {
      found: true,
      route: facts.ref,
      method: facts.method,
      path: facts.path,
      folder: facts.folder,
      module: facts.module,
      own: facts.own,
      inScope: !keys || keys.has(scopeRouteKey(facts.method, facts.path)),
      controller: facts.controller,
      handler: facts.handler,
      authStatus: facts.auth.status,
      authGuards: facts.auth.guards,
      unauthorized7d: facts.auth.unauthorized,
      parameters: facts.parameters,
      state: state.state,
      verdict: state.verdict,
      requests24h: state.requests,
      p95Ms: state.p95Ms,
      firstCallAt: state.firstCallAt,
      lastCallAt: state.lastCallAt,
      registeredAt: facts.registeredAt,
      routePath: routeLink(facts.ref),
      testerPath: testerLink(facts.ref),
    };
  },
};
