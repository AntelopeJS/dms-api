import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const routeWatchTableName = "route_watch";

/** A registered route as the watch last saw it. */
export interface WatchedRoute {
  /** `METHOD /path`. */
  ref: string;
  module: string | null;
  own: boolean;
}

/**
 * The registered routes the `api.route-registered` trigger last saw, one
 * document for the whole platform: what a deploy is compared with, across
 * restarts.
 */
@RegisterTable(routeWatchTableName, SCHEMA_NAME)
export class RouteWatch extends Table {
  @Field("any")
  declare routes: WatchedRoute[];

  /** Hash of the sorted refs: what a writer expects to replace. */
  @Field("string")
  declare revision: string;

  @Field("date")
  declare updatedAt: Date;
}
