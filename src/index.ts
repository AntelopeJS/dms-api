// oxlint-disable-next-line import/no-duplicates -- evaluated here on purpose, ahead of the named import below: the module has to be initialised before anything that reaches into it
import "./db";
import "./routes";
import "./services/request-log/capture";
import "./pages";

import { getRegisteredRoutes } from "@antelopejs/interface-api";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import cron, { type ScheduledTask } from "node-cron";
import {
  registerAutomationNodes,
  unregisterAutomationNodes,
} from "./automation";
import { type DmsApiConfig, getBaseConfig, setConfig } from "./config";
import {
  ApiSettingsModel,
  RequestLogModel,
  RouteModel,
  RouteStatisticsModel,
} from "./db";
import { registerLiveTopics } from "./realtime";
import {
  loadSettings,
  pruneAllStatistics,
  pruneRequestLogs,
  syncRoutes,
} from "./services";
import { isSensitiveHeader } from "./services/request-log/redaction";
import { configErrors } from "./services/settings-form";
import { SCHEMA_NAME } from "./types/constants";
import { frontendModule } from "./frontend-module";

let pruneTask: ScheduledTask | null = null;

/**
 * Applies the module configuration, and refuses at start a value the
 * Settings form could not save back.
 */
export async function construct(config?: Partial<DmsApiConfig>): Promise<void> {
  setConfig(config);
  const errors = configErrors(getBaseConfig(), isSensitiveHeader);
  if (errors.length) {
    throw new Error(`[dms-api] invalid configuration: ${errors.join("; ")}`);
  }

  await AddFrontendModule(frontendModule());
}

/**
 * Binds the schema, loads the settings, syncs the routes table, schedules the
 * hourly retention pass (it prunes both the aggregated statistics and the
 * per-request logs), registers the automation nodes, and has the live mode of
 * the monitoring pages hear of new requests.
 */
export async function start(): Promise<void> {
  await RegisterSchema(SCHEMA_NAME);
  await loadSettings(GetModel(ApiSettingsModel));
  const routesModel = GetModel(RouteModel);
  await syncRoutes(routesModel, getRegisteredRoutes());

  const statsModel = GetModel(RouteStatisticsModel);
  const logModel = GetModel(RequestLogModel);

  pruneTask = cron.schedule("0 * * * *", () => {
    void pruneAllStatistics(statsModel);
    void pruneRequestLogs(logModel);
  });

  registerAutomationNodes();
  registerLiveTopics();
}

export function destroy(): void {}

export async function stop(): Promise<void> {
  unregisterAutomationNodes();
  if (pruneTask) {
    await pruneTask.stop();
    pruneTask = null;
  }
}
