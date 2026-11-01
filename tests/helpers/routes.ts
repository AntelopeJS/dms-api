import {
  RegisterRoute,
  type RouteHandler,
  UnregisterRoute,
} from "@antelopejs/interface-api";

/** The ids of the routes {@link registerRoutes} registered and nothing unregistered yet. */
const registeredIds: number[] = [];

/** A route handler as a controller method registers it, `fields` overriding its defaults. */
export function routeHandler(
  method: string,
  location: string,
  fields: Partial<RouteHandler> = {},
): RouteHandler {
  return {
    mode: "handler",
    method,
    location,
    callback: function handle() {},
    parameters: [],
    properties: {},
    proto: {},
    ...fields,
  };
}

/**
 * Registers `handlers` with the API interface, as the controllers of a
 * module do. Returns their route ids, in order.
 */
export function registerRoutes(...handlers: RouteHandler[]): string[] {
  return handlers.map((handler) => {
    const id = RegisterRoute(handler);
    registeredIds.push(id);
    return String(id);
  });
}

/** Unregisters every route {@link registerRoutes} registered. */
export function unregisterRoutes(): void {
  for (const id of registeredIds.splice(0)) UnregisterRoute(id);
}
