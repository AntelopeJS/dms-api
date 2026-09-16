import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const apiSettingsTableName = "api_settings";

/**
 * Single-document table holding the runtime-editable API console settings.
 * Every numeric field is an override of the code-level `DmsApiConfig`
 * default; null means "use the default". `scope` drives which routes the
 * monitoring pages take into account (see {@link RouteScope}).
 */
@RegisterTable(apiSettingsTableName, SCHEMA_NAME)
export class ApiSettings extends Table {
  /** Route visibility scope: "own" | "modules" | "all". */
  @Field("string")
  declare scope: string;

  /** Override of statisticsLifetime (ms); null → config default. */
  @Field("number")
  declare statisticsLifetime: number | null;

  /** Override of requestLogRetention (ms); null → config default. */
  @Field("number")
  declare requestLogRetention: number | null;

  /** Override of requestSlownessThreshold (ms); null → config default. */
  @Field("number")
  declare requestSlownessThreshold: number | null;

  /** Override of requestLogMaxBodySize (bytes); null → config default. */
  @Field("number")
  declare requestLogMaxBodySize: number | null;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
