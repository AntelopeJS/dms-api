import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const migrationsTableName = "migrations";

/**
 * One row per maintenance pass over data stored by an earlier version, keyed
 * by the pass's name: a pass that completed does not run again, and one cut
 * short resumes from its cursor.
 */
@RegisterTable(migrationsTableName, SCHEMA_NAME)
export class Migration extends Table {
  /** When the pass finished; absent while it still has rows to go through. */
  @Field("date")
  declare completedAt?: Date;

  /** Where an unfinished pass resumes. */
  @Field("string")
  declare cursor?: string;
}
