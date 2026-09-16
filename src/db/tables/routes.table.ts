import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import type { HttpMethod } from "@/types";
import { SCHEMA_NAME } from "../../types/constants";

export const routesTableName = "routes";

@RegisterTable(routesTableName, SCHEMA_NAME)
export class Route extends Table {
  @Field("string")
  declare uri: string;

  @Field("string")
  declare method: HttpMethod;

  /** Antelope module that registered the route; null when unresolvable. */
  @Field("string")
  declare module: string | null;

  /** True when the registering module is loaded from the local project (source.type === "local"). */
  @Field("boolean")
  declare own: boolean;

  @CreationTime()
  @Index()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Index()
  @Field("date")
  declare updatedAt: Date;
}
