import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  ApiSettings,
  apiSettingsTableName,
} from "../tables/api_settings.table";

export class ApiSettingsModel extends BasicDataModel(
  ApiSettings,
  apiSettingsTableName,
) {
  /** The settings table is a singleton document. */
  async getSingleton(): Promise<ApiSettings | undefined> {
    const all = await this.getAll();
    return all[0];
  }
}
