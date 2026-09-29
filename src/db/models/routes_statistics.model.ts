import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database/atomic";
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

  /**
   * Write `doc.statistics` only if the stored row still carries the revision
   * `doc` was read with. A plain `update` overwrites the whole array, so two
   * overlapping read-modify-writes would drop one of them; callers re-read and
   * retry on "not-applied" instead.
   */
  async replaceStatistics(
    doc: RouteStatistics,
  ): Promise<AtomicMutationOutcome> {
    return this.table
      .atomicMutation(doc._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: doc.revision ?? { kind: "missing" },
        nextRevision: randomUUID(),
        patch: { statistics: doc.statistics },
      })
      .run();
  }
}
