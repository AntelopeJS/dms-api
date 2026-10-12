import type {
  ComputedParameter,
  ParameterProvider,
} from "@antelopejs/interface-api";
import { describe, expect, it, vi } from "vitest";
import type { RequestLogSample } from "@/db/models/request_log.model";
import type { RequestLog } from "@/db/tables/request_log.table";
import { apiOrigin } from "@/services/api-origin";
import { handlerMethod, type RouteInspection } from "@/services/introspection";
import { parseControllerDecorators } from "@/services/introspection/decorators";
import { probeHandlerErrors } from "@/services/introspection/errors";
import { probeProvider } from "@/services/introspection/probe";
import {
  authOf,
  countRoutes,
  folderOf,
  listRoutes,
  parseRouteRef,
  pipelineOf,
  requiresAuth,
} from "@/services/route-catalog";
import {
  contractOf,
  documentParameters,
  valueType,
} from "@/services/route-contract";

const registered = vi.hoisted(() => ({
  handlers: [] as Array<{ id: string; handler: Record<string, unknown> }>,
}));

const apiBase = vi.hoisted(() => ({ url: undefined as string | undefined }));

vi.mock("@antelopejs/interface-dms/api-base-url", () => ({
  GetApiBaseUrl: () => Promise.resolve(apiBase.url),
}));

vi.mock("@antelopejs/interface-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@antelopejs/interface-api")>()),
  getRegisteredRouteHandlers: () => registered.handlers,
}));

function inspection(overrides: Partial<RouteInspection> = {}): RouteInspection {
  return {
    id: "1",
    location: "/api/orders",
    method: "post",
    mode: "handler",
    callbackName: "create",
    controllerName: "OrdersController",
    module: "shop",
    parameters: [],
    properties: [],
    applicableMiddleware: [],
    errorCodes: [],
    authGuards: [],
    ...overrides,
  };
}

function log(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    _id: "l",
    timestamp: new Date("2026-10-09T12:00:00Z"),
    method: "POST",
    uri: "/api/orders",
    rawPath: "/api/orders",
    pathParams: {},
    query: {},
    requestHeaders: {},
    requestBodyTruncated: false,
    statusCode: 201,
    responseTimeMs: 40,
    responseHeaders: {},
    responseBodyTruncated: false,
    ...overrides,
  } as RequestLog;
}

function sample(
  statusCode: number,
  errorMessage?: string,
  at = "2026-10-09T12:00:00Z",
): RequestLogSample {
  return {
    timestamp: new Date(at),
    method: "POST",
    uri: "/api/orders",
    statusCode,
    responseTimeMs: statusCode < 400 ? 100 : 5,
    errorMessage,
  };
}

describe("folderOf", () => {
  it("groups a route under its first two static segments", () => {
    expect(folderOf("/api/orders/:id/refund")).toBe("/api/orders");
    expect(folderOf("/api/orders")).toBe("/api/orders");
    expect(folderOf("/webhooks/stripe")).toBe("/webhooks/stripe");
    expect(folderOf("/users/:id")).toBe("/users");
  });
});

describe("parseRouteRef", () => {
  it("reads `METHOD /path`, whatever the case of the method", () => {
    expect(parseRouteRef("post /api/orders")).toEqual({
      method: "POST",
      path: "/api/orders",
    });
    expect(parseRouteRef("/api/orders")).toBeUndefined();
    expect(parseRouteRef(undefined)).toBeUndefined();
  });
});

describe("listRoutes", () => {
  const handler = (method: string, location: string) => ({
    id: `${method} ${location}`,
    handler: {
      mode: "handler",
      method,
      location,
      callback: function list() {},
    },
  });

  it("lists the canonical path, without the controller's trailing slash", () => {
    registered.handlers = [
      handler("get", "/api/orders/"),
      handler("get", "/"),
      handler("post", "/api/orders/:id/refund"),
    ];
    expect(
      listRoutes(null).map(({ ref, path, folder }) => ({ ref, path, folder })),
    ).toEqual([
      { ref: "GET /", path: "/", folder: "/" },
      { ref: "GET /api/orders", path: "/api/orders", folder: "/api/orders" },
      {
        ref: "POST /api/orders/:id/refund",
        path: "/api/orders/:id/refund",
        folder: "/api/orders",
      },
    ]);
  });

  it("leaves out the DMS page layouts, from the list and the count", () => {
    registered.handlers = [
      handler("get", "/home/pagelayout"),
      handler("get", "/notes/pagelayout/"),
      handler("get", "/api/orders"),
      handler("get", "/api/pagelayouts"),
    ];
    expect(listRoutes(null).map(({ ref }) => ref)).toEqual([
      "GET /api/orders",
      "GET /api/pagelayouts",
    ]);
    expect(countRoutes(null)).toBe(2);
    expect(
      countRoutes(new Set(["GET:/home/pagelayout", "GET:/api/orders"])),
    ).toBe(1);
  });
});

describe("pipelineOf", () => {
  it("orders what runs before, the handler, after, then the monitors", () => {
    const steps = pipelineOf(
      inspection({
        applicableMiddleware: [
          {
            id: "m",
            mode: "monitor",
            location: "/",
            method: "any",
            callbackName: "capture",
            isAuth: false,
          },
          {
            id: "a",
            mode: "postfix",
            location: "/api",
            method: "any",
            callbackName: "audit",
            isAuth: false,
          },
          {
            id: "r",
            mode: "prefix",
            location: "/api",
            method: "any",
            callbackName: "rateLimit",
            priority: 2,
            isAuth: false,
          },
          {
            id: "s",
            mode: "prefix",
            location: "/api",
            method: "any",
            callbackName: "requireAuth",
            priority: 0,
            isAuth: true,
          },
        ],
      }),
    );
    expect(steps.map((step) => step.name)).toEqual([
      "requireAuth",
      "rateLimit",
      "OrdersController.create",
      "audit",
      "capture",
    ]);
  });
});

describe("authentication", () => {
  it("is required when a guard was found, whatever the traffic", () => {
    const guarded = inspection({ authGuards: ["AuthUserWithPermission"] });
    expect(requiresAuth(guarded)).toBe(true);
    expect(authOf(guarded, [])).toEqual({
      status: "required",
      guards: ["AuthUserWithPermission"],
      unauthorized: 0,
    });
  });

  it("is probable when the route answered 401, unknown otherwise, never public", () => {
    expect(requiresAuth(inspection())).toBe(false);
    expect(authOf(inspection(), [{ status: 401, count: 14 }])).toMatchObject({
      status: "probable",
      unauthorized: 14,
    });
    expect(authOf(inspection(), [{ status: 200, count: 3 }]).status).toBe(
      "unknown",
    );
  });

  it("recognises the guard providers, the DMS's and hand-written ones", () => {
    // interface-auth's CreateAuthDecorator provider, as compiled.
    const internal = {
      CheckAuthentication: (..._args: unknown[]) => undefined,
    };
    const provider = (read: ParameterProvider): ComputedParameter => ({
      provider: read,
      modifiers: [],
    });
    expect(
      probeProvider(
        provider((context) =>
          internal.CheckAuthentication(context.rawRequest, context.rawResponse),
        ),
      ).source,
    ).toBe("auth");
    expect(
      probeProvider(provider((ctx) => ctx.rawRequest.headers.authorization))
        .source,
    ).toBe("auth");
    expect(
      probeProvider(provider((ctx) => ctx.rawRequest.headers["x-tenant"]))
        .source,
    ).toBe("header");
  });
});

describe("parseControllerDecorators", () => {
  const compiled = `
class RoutesController extends (0, interface_api_1.Controller)("/api/monitoring/routes") {
    async getDetail(_user, route) { return route; }
}
exports.RoutesController = RoutesController;
__decorate([
    (0, interface_api_1.Get)("detail"),
    __param(0, (0, guards_1.AuthUserWithPermission)(explorer.targetChild("header", "a,b"))),
    __param(1, (0, interface_api_1.Parameter)("route", "query")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Function, String]),
    __metadata("design:returntype", Promise)
], RoutesController.prototype, "getDetail", null);
__decorate([
    (0, guards_1.AuthUser)(),
    __metadata("design:type", Object)
], RoutesController.prototype, "user", void 0);
exports.RoutesController = RoutesController = __decorate([
    (0, auth_1.Authentication)()
], RoutesController);
__decorate([
    (0, interface_api_1.Get)("other"),
    __param(0, (0, interface_api_1.Parameter)("id")),
    __metadata("design:paramtypes", [Number])
], OtherController.prototype, "get", null);
`;

  it("reads the guards, names and types TypeScript compiled next to the class", () => {
    expect(parseControllerDecorators(compiled, "RoutesController")).toEqual({
      classDecorators: ["Authentication"],
      propertyDecorators: { user: ["AuthUser"] },
      methods: {
        getDetail: [
          {
            index: 0,
            decorator: "AuthUserWithPermission",
            args: [null],
            type: "Function",
          },
          {
            index: 1,
            decorator: "Parameter",
            args: ["route", "query"],
            type: "String",
          },
        ],
      },
    });
    expect(
      parseControllerDecorators(compiled, "OtherController").methods.get,
    ).toEqual([
      { index: 0, decorator: "Parameter", args: ["id"], type: "Number" },
    ]);
  });
});

describe("error codes from the handler", () => {
  it("reads the method on the prototype when the callback is a proxy", () => {
    class OrdersController {
      async create(this: void, body: { items?: unknown[] }) {
        if (!body.items?.length) {
          return new HTTPResult(400, { error: "Cart is empty" });
        }
        throw new HTTPResult(422, { error: "Insufficient stock" });
      }
    }
    // What the runtime hands out across modules: unreadable source, same name.
    const callback = new Proxy(OrdersController.prototype.create, {});
    expect(Function.prototype.toString.call(callback)).toContain("native code");
    const method = handlerMethod({
      callback,
      proto: OrdersController.prototype,
    });
    expect(probeHandlerErrors(method)).toEqual([
      { status: 400, reason: "Cart is empty", source: "HTTPResult" },
      { status: 422, reason: "Insufficient stock", source: "HTTPResult" },
    ]);
  });
});

class HTTPResult {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

describe("contractOf", () => {
  const successful = [
    log({
      timestamp: new Date("2026-10-09T12:00:00Z"),
      requestBody: '{"customerId":"C-1","items":[]}',
      responseBody: '{"id":"10481","status":"pending_payment"}',
      query: { dryRun: "true" },
    }),
    log({
      timestamp: new Date("2026-10-08T12:00:00Z"),
      requestBody: '{"customerId":"C-2","items":[],"currency":"EUR"}',
      responseBody: '{"id":"10480","status":"paid"}',
    }),
  ];

  it("counts every status of the window with all its messages", () => {
    const contract = contractOf({
      samples: [
        sample(201),
        sample(201),
        sample(422, "Insufficient stock for SKU A"),
        sample(422, "Insufficient stock for SKU B", "2026-10-09T13:00:00Z"),
        sample(422, "Insufficient stock for SKU A"),
        sample(500, "Unexpected end of JSON input"),
      ],
      successful,
      latest: [log({ statusCode: 422, query: { page: "2" } })],
    });
    expect(contract.total).toBe(6);
    expect(
      contract.statuses.map(({ status, count }) => [status, count]),
    ).toEqual([
      [201, 2],
      [422, 3],
      [500, 1],
    ]);
    expect(contract.statuses[1]).toMatchObject({
      message: "Insufficient stock for SKU A",
      messages: [
        { message: "Insufficient stock for SKU A", count: 2 },
        { message: "Insufficient stock for SKU B", count: 1 },
      ],
      messageCount: 2,
      lastSeen: "2026-10-09T13:00:00.000Z",
    });
    expect(contract.queryParams).toEqual(["dryRun", "page"]);
    expect(contract.latency).toEqual({ p50: 100, p95: 100 });
  });

  it("lists the most frequent messages and counts them all", () => {
    const contract = contractOf({
      samples: Array.from({ length: 12 }, (_, index) =>
        sample(404, `Order ${index} not found`),
      ),
      successful: [],
      latest: [],
    });
    expect(contract.statuses[0].messages).toHaveLength(10);
    expect(contract.statuses[0].messageCount).toBe(12);
  });

  it("infers the body and the response from the successful calls only", () => {
    const contract = contractOf({ samples: [], successful, latest: [] });
    expect(contract.sampled).toBe(2);
    expect(contract.exampleBody).toEqual({ customerId: "C-1", items: [] });
    expect(contract.bodyFields).toEqual([
      { name: "customerId", types: ["string"], required: true, example: "C-1" },
      { name: "items", types: ["array"], required: true },
      { name: "currency", types: ["string"], required: false, example: "EUR" },
    ]);
    expect(contract.exampleQuery).toEqual({ dryRun: "true" });
    expect(contract.exampleResponse).toEqual({
      status: 201,
      body: '{\n  "id": "10481",\n  "status": "pending_payment"\n}',
      json: true,
      truncated: false,
    });
    expect(contract.responseKind).toBe("object");
    expect(contract.responseFields.map((field) => field.name)).toEqual([
      "id",
      "status",
    ]);
  });
});

describe("documentParameters", () => {
  it("types each parameter and gives the value of the last successful call", () => {
    const route = inspection({
      location: "/api/customers/:id",
      parameters: [
        {
          index: 0,
          name: "id",
          source: "param",
          multi: false,
          inferredType: "string",
          modifierCount: 0,
        },
        {
          index: 1,
          name: "limit",
          source: "query",
          multi: false,
          inferredType: "number",
          modifierCount: 0,
        },
      ],
    });
    const parameters = documentParameters(
      route,
      [
        log({ pathParams: { id: "C-00988" }, query: { sort: "name" } }),
        log({ pathParams: { id: "C-1" }, query: { limit: "20" } }),
      ],
      ["sort"],
    );
    expect(parameters).toEqual([
      {
        name: "id",
        in: "path",
        type: "string",
        example: "C-00988",
        declared: true,
        required: true,
      },
      {
        name: "limit",
        in: "query",
        type: "number",
        example: "20",
        declared: true,
        required: false,
      },
      {
        name: "sort",
        in: "query",
        type: "string",
        example: "name",
        declared: false,
        required: false,
      },
    ]);
    expect(valueType("42")).toBe("number");
    expect(valueType("0b6f3c2e-1d2a-4f3b-9c1e-2a3b4c5d6e7f")).toBe("uuid");
    expect(valueType("2026-10-09")).toBe("date");
  });
});

describe("apiOrigin", () => {
  it("is the DMS API origin, without a trailing slash", async () => {
    apiBase.url = "https://api.example.com/";
    expect(await apiOrigin()).toBe("https://api.example.com");
  });

  it("is null when the DMS configuration clears it", async () => {
    apiBase.url = undefined;
    expect(await apiOrigin()).toBeNull();
  });
});
