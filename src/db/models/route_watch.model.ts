import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  RouteWatch,
  routeWatchTableName,
  type WatchedRoute,
} from "../tables/route_watch.table";

/** Id of the one document of the route watch. */
export const ROUTE_WATCH_ID = "registered";

export class RouteWatchModel extends BasicDataModel(
  RouteWatch,
  routeWatchTableName,
) {
  async current(): Promise<RouteWatch | undefined> {
    return this.get(ROUTE_WATCH_ID);
  }

  /**
   * Stores the first set seen. False when another writer stored one first:
   * the document is keyed, so only one insert lands.
   */
  async create(routes: WatchedRoute[], revision: string): Promise<boolean> {
    try {
      await this.insert({
        _id: ROUTE_WATCH_ID,
        routes,
        revision,
        updatedAt: new Date(),
      });
      return true;
    } catch (error) {
      if (await this.current()) return false;
      throw error;
    }
  }

  /**
   * Replaces the stored set when it is still at `expected`. False when
   * another writer recorded a change first.
   */
  async replace(
    expected: string,
    routes: WatchedRoute[],
    revision: string,
  ): Promise<boolean> {
    const updated = await this.table
      .filter((doc) =>
        doc.key("_id").eq(ROUTE_WATCH_ID).and(doc.key("revision").eq(expected)),
      )
      .update({ routes, revision, updatedAt: new Date() })
      .run();
    return updated > 0;
  }
}
