import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { DayStatistics } from "@/types";
import { SCHEMA_NAME } from "../../types/constants";

export const routesStatisticsTableName = "routes_statistics";

/**
 * Canonical casing of an HTTP method as stored in the route tables
 * (`routes`, `routes_statistics`, `request_log`).
 */
export function normalizeRouteMethod(method: string): string {
  return method.toUpperCase();
}

/**
 * Canonical form of a route path as stored in the route tables: without its
 * trailing slash, except for the root `/`. A controller mounted on
 * `/api/orders` registers its index handler as `/api/orders/`, while clients
 * call `/api/orders`; both name the same route.
 */
export function normalizeRoutePath(uri: string): string {
  return uri.length > 1 ? uri.replace(/\/+$/, "") || "/" : uri;
}

/**
 * Generate composite key for route statistics
 * Format: "METHOD:uri" (e.g., "GET:/api/users/:id")
 * Method is normalized to uppercase and the path to its canonical form, so a
 * key built from a handler location (`/api/orders/`) matches the stored one.
 */
export function getRouteStatsKey(method: string, uri: string): string {
  return `${normalizeRouteMethod(method)}:${normalizeRoutePath(uri)}`;
}

@RegisterTable(routesStatisticsTableName, SCHEMA_NAME)
export class RouteStatistics extends Table {
  @Field("string")
  declare method: string;

  @Field("string")
  declare uri: string;

  @Field(["any"])
  declare statistics: DayStatistics[];

  /**
   * Optimistic-concurrency token, replaced on every write of `statistics`
   * (see {@link RouteStatisticsModel.replaceStatistics}). Absent on legacy rows
   * until their first guarded write.
   */
  @Field("string")
  declare revision?: string;
}
