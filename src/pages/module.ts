import { readFileSync } from "node:fs";
import path from "node:path";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  Category,
  type ModuleCatalogContext,
  type ModuleReadoutLine,
  type ModuleStatus,
  RegisterModule,
} from "@antelopejs/interface-dms/page";
import { RequestLogModel, RouteModel, RouteStatisticsModel } from "@/db";
import { getHealth } from "@/services/overview";
import { countRoutes } from "@/services/route-catalog";
import { getScopedRouteKeys } from "@/services/scope";
import { getActiveScope } from "@/services/settings";

const MODULE_ID = "api";

/**
 * The page the module opens on: the Overview, under the Monitor heading. The
 * DMS answers `/modules/api` (a typed URL, a sign-in coming back, the "API"
 * crumb) with a redirect to it, query and hash kept.
 */
const LANDING_PAGE = "overview";

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
    countRoutes(keys),
  );
}

async function catalogStatus(): Promise<ModuleStatus> {
  const health = await currentHealth();
  return health.verdict === "down" || health.verdict === "degraded"
    ? "attention"
    : "live";
}

/** Numbers written the way the catalog's reader writes them. */
function numberFormat(language: string | undefined): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(language || undefined);
  } catch {
    return new Intl.NumberFormat();
  }
}

/**
 * The catalog tile's two lines. A readout line is an i18n key or a literal,
 * without parameters: the state is a key, translated; the figures are a line
 * of their own, in words both languages share, with the numbers formatted in
 * the user's language. The state line carries the tone, so the red mark sits
 * on "Routes failing", not on the route count.
 */
async function catalogReadout({
  user,
}: ModuleCatalogContext): Promise<ModuleReadoutLine[]> {
  const health = await currentHealth();
  const number = numberFormat(user?.language);
  return [
    stateReadout(health),
    {
      tone: "info",
      text: `${number.format(health.routes.value)} routes · ${number.format(health.latency.value)} ms`,
    },
  ];
}

function stateReadout(
  health: Awaited<ReturnType<typeof currentHealth>>,
): ModuleReadoutLine {
  if (health.calls.value === 0) {
    return { tone: "info", text: "$api.module.readout.idle" };
  }
  if (health.failingRoutes > 0) {
    return { tone: "error", text: "$api.module.readout.failing" };
  }
  if (health.routes.needingAttention > 0) {
    return { tone: "warning", text: "$api.module.readout.attention" };
  }
  return { tone: "success", text: "$api.module.readout.healthy" };
}

export const apiModule = RegisterModule({
  id: MODULE_ID,
  title: "$api.module.title",
  description: "$api.module.description",
  icon: "i-ph-plugs",
  landingPage: LANDING_PAGE,
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
