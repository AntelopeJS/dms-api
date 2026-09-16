import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  getRouteStatsKey,
  RouteStatistics,
  routesStatisticsTableName,
} from "../tables/routes_statistics.table";

export class RouteStatisticsModel extends BasicDataModel(
  RouteStatistics,
  routesStatisticsTableName,
) {
  /**
   * Get statistics by method and URI using composite key
   */
  async getByRoute(
    method: string,
    uri: string,
  ): Promise<RouteStatistics | undefined> {
    const id = getRouteStatsKey(method, uri);
    return this.get(id);
  }
}
