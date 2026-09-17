// Evaluated here on purpose, ahead of the named import below: the module has
// to be initialised before anything that reaches into it.
// oxlint-disable-next-line import/no-duplicates
import "./db";
import "./routes";
import "./middlewares";
import "./pages";

import path from "node:path";
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
import { type DmsApiConfig, setConfig } from "./config";
import {
  ApiSettingsModel,
  RequestLogModel,
  RouteModel,
  RouteStatisticsModel,
} from "./db";
import {
  loadSettings,
  pruneAllStatistics,
  pruneRequestLogs,
  syncRoutes,
} from "./services";
import { SCHEMA_NAME } from "./types/constants";

let pruneTask: ScheduledTask | null = null;

export async function construct(config?: Partial<DmsApiConfig>): Promise<void> {
  setConfig(config);

  await AddFrontendModule({
    name: "@antelopejs/dms-api-frontend-vue",
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    configKey: "dmsApi",
    priority: 0,
  });
}

export async function start(): Promise<void> {
  await RegisterSchema(SCHEMA_NAME);
  await loadSettings(GetModel(ApiSettingsModel));
  const routesModel = GetModel(RouteModel);
  await syncRoutes(routesModel, getRegisteredRoutes());

  const statsModel = GetModel(RouteStatisticsModel);
  const logModel = GetModel(RequestLogModel);

  // Hourly retention pass: prune both aggregated statistics and per-request logs.
  pruneTask = cron.schedule("0 * * * *", () => {
    void pruneAllStatistics(statsModel);
    void pruneRequestLogs(logModel);
  });

  registerAutomationNodes();
}

export function destroy(): void {}

export async function stop(): Promise<void> {
  unregisterAutomationNodes();
  if (pruneTask) {
    await pruneTask.stop();
    pruneTask = null;
  }
}
