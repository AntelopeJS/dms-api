import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Route, routesTableName } from "../tables/routes.table";
import { normalizeRouteMethod } from "../tables/routes_statistics.table";

export class RouteModel extends BasicDataModel(Route, routesTableName) {
  /**
   * Find a synced route by method and URI pattern. This is the stable
   * identity of a route: the ids from `getRegisteredRoutes()` are an
   * in-process counter, reassigned on every start, and are not stored here.
   */
  async getByRoute(method: string, uri: string): Promise<Route | undefined> {
    const normalized = normalizeRouteMethod(method);
    const [route] = await this.table
      .filter((row) =>
        row.key("method").eq(normalized).and(row.key("uri").eq(uri)),
      )
      .slice(0, 1)
      .run();
    return RouteModel.fromDatabase(route);
  }
}
