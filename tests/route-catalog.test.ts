import { describe, expect, it } from "vitest";
import type { RouteInspection } from "@/services/introspection";
import {
  folderOf,
  parseRouteRef,
  pipelineOf,
  requiresAuth,
} from "@/services/route-catalog";

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
    ...overrides,
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

describe("requiresAuth", () => {
  it("sees an auth middleware or a parameter reading the session", () => {
    expect(requiresAuth(inspection())).toBe(false);
    expect(
      requiresAuth(
        inspection({
          parameters: [
            {
              index: 0,
              name: null,
              source: "unknown",
              multi: false,
              inferredType: "unknown",
              modifierCount: 0,
              rawProviderSource:
                "(ctx) => ctx.rawRequest.headers.authorization",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
