import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { DayStatistics, HttpMethod } from "@/types";
import { SCHEMA_NAME } from "../../types/constants";

export const routesStatisticsTableName = "routes_statistics";

/**
 * Generate composite key for route statistics
 * Format: "METHOD:uri" (e.g., "GET:/api/users/:id")
 * Method is normalized to uppercase for consistency
 */
export function getRouteStatsKey(method: string, uri: string): string {
  return `${method.toUpperCase()}:${uri}`;
}

@RegisterTable(routesStatisticsTableName, SCHEMA_NAME)
export class RouteStatistics extends Table {
  @Field("string")
  declare method: HttpMethod;

  @Field("string")
  declare uri: string;

  @Field(["any"])
  declare statistics: DayStatistics[];

  /**
   * Optimistic-concurrency token, replaced on every write of `statistics`
   * (see {@link RouteStatisticsModel.replaceStatistics}). Absent on rows
   * written before it existed; the first guarded write installs it.
   */
  @Field("string")
  declare revision?: string;
}
