import { readFileSync } from "node:fs";
import path from "node:path";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  Category,
  type ModuleReadoutLine,
  type ModuleStatus,
  RegisterModule,
} from "@antelopejs/interface-dms/page";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { getHealth } from "@/services/overview";
import { countScopedRoutes, getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";

const MODULE_ID = "api";

function packageVersion(): string | undefined {
  try {
    const manifest = readFileSync(
      path.join(__dirname, "../../package.json"),
      "utf8",
    );
    return (JSON.parse(manifest) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

async function currentHealth() {
  const routes = GetModel(RouteModel);
  const keys = await getScopedRouteKeys(routes, getActiveScope());
  return getHealth(
    {
      logs: GetModel(RequestLogModel),
      stats: GetModel(RouteStatisticsModel),
      routes,
    },
    keys,
    await countScopedRoutes(routes, keys),
  );
}

async function catalogStatus(): Promise<ModuleStatus> {
  const health = await currentHealth();
  return health.verdict === "down" || health.verdict === "degraded"
    ? "attention"
    : "live";
}

async function catalogReadout(): Promise<ModuleReadoutLine[]> {
  const health = await currentHealth();
  return [
    {
      tone: health.failingRoutes > 0 ? "error" : "success",
      text: `${health.routes.value} routes · ${health.latency.value} ms avg`,
    },
    {
      tone: health.errors.share > 0 ? "warning" : "info",
      text: `${health.errors.share}% errors · 24 h`,
    },
  ];
}

export const apiModule = RegisterModule({
  id: MODULE_ID,
  title: "$api.module.title",
  description: "$api.module.description",
  icon: "i-ph-plugs",
  landingPage: "overview",
  version: packageVersion(),
  catalogCategory: "$api.module.catalog_category",
  status: catalogStatus,
  readout: catalogReadout,
});

/** Sidebar section: is anything broken, and why. */
export const monitorCategory = Category("monitor", {
  displayName: "$api.nav.monitor",
  icon: "i-ph-pulse",
  category: apiModule,
  type: "label",
  urlSlug: "/",
  order: 0,
});

/** Sidebar section: what the API offers. */
export const exploreCategory = Category("explore", {
  displayName: "$api.nav.explore",
  icon: "i-ph-compass",
  category: apiModule,
  type: "label",
  urlSlug: "/",
  order: 1,
});

/** Sidebar section: how the console behaves. */
export const configureCategory = Category("configure", {
  displayName: "$api.nav.configure",
  icon: "i-ph-sliders-horizontal",
  category: apiModule,
  type: "label",
  urlSlug: "/",
  order: 2,
});
