import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Migration, migrationsTableName } from "../tables/migrations.table";

export class MigrationModel extends BasicDataModel(
  Migration,
  migrationsTableName,
) {
  /** Record where the pass `id` stands, creating its row the first time. */
  async record(
    id: string,
    state: Pick<Migration, "completedAt" | "cursor">,
  ): Promise<void> {
    await this.table
      .insert({ _id: id, ...state }, { conflict: "replace" })
      .run();
  }
}
