import { applyConfigOverrides, type DmsApiConfig, getConfig } from "@/config";
import type { ApiSettingsModel } from "@/db";
import type { ApiSettings } from "@/db/tables/api_settings.table";
import { isRouteScope, type RouteScope } from "./scope";

/**
 * Runtime settings service.
 *
 * The `api_settings` singleton document stores the Settings-page values:
 * the route scope plus numeric overrides of the code-level config. On load
 * (module start) and on every save, the numeric overrides are pushed into
 * the config layer (`applyConfigOverrides`) so every existing `getConfig()`
 * call site — capture middleware, prune crons, aggregations — picks them up
 * without knowing about the DB. The scope is cached here for synchronous
 * access from the read endpoints.
 */

export interface ApiSettingsPayload {
  scope: RouteScope;
  statisticsLifetime: number;
  requestLogRetention: number;
  requestSlownessThreshold: number;
  requestLogMaxBodySize: number;
}

export interface ApiSettingsUpdate {
  scope?: RouteScope;
  statisticsLifetime?: number | null;
  requestLogRetention?: number | null;
  requestSlownessThreshold?: number | null;
  requestLogMaxBodySize?: number | null;
}

const DEFAULT_SCOPE: RouteScope = "own";

let activeScope: RouteScope = DEFAULT_SCOPE;

/** Scope currently applied to the monitoring pages (cached in memory). */
export function getActiveScope(): RouteScope {
  return activeScope;
}

function overridesFrom(doc: SettingsDocument): Partial<DmsApiConfig> {
  const overrides: Partial<DmsApiConfig> = {};
  if (doc.statisticsLifetime != null) {
    overrides.statisticsLifetime = doc.statisticsLifetime;
  }
  if (doc.requestLogRetention != null) {
    overrides.requestLogRetention = doc.requestLogRetention;
  }
  if (doc.requestSlownessThreshold != null) {
    overrides.requestSlownessThreshold = doc.requestSlownessThreshold;
  }
  if (doc.requestLogMaxBodySize != null) {
    overrides.requestLogMaxBodySize = doc.requestLogMaxBodySize;
  }
  return overrides;
}

type SettingsDocument = Pick<
  ApiSettings,
  | "scope"
  | "statisticsLifetime"
  | "requestLogRetention"
  | "requestSlownessThreshold"
  | "requestLogMaxBodySize"
>;

function applyDocument(doc: SettingsDocument | undefined): void {
  activeScope = doc && isRouteScope(doc.scope) ? doc.scope : DEFAULT_SCOPE;
  applyConfigOverrides(doc ? overridesFrom(doc) : {});
}

/** Load persisted settings and apply them; called once at module start. */
export async function loadSettings(model: ApiSettingsModel): Promise<void> {
  applyDocument(await model.getSingleton());
}

/** Effective values currently in force (config defaults + DB overrides). */
export function getEffectiveSettings(): ApiSettingsPayload {
  const config = getConfig();
  return {
    scope: activeScope,
    statisticsLifetime: config.statisticsLifetime,
    requestLogRetention: config.requestLogRetention,
    requestSlownessThreshold: config.requestSlownessThreshold,
    requestLogMaxBodySize: config.requestLogMaxBodySize,
  };
}

/**
 * Persist a settings update (partial; `null` clears a numeric override back
 * to the config default) and re-apply the merged result immediately.
 */
type SettingsDoc = Awaited<ReturnType<ApiSettingsModel["getSingleton"]>>;

export async function updateSettings(
  model: ApiSettingsModel,
  update: ApiSettingsUpdate,
): Promise<ApiSettingsPayload> {
  const existing = await model.getSingleton();
  const next = buildNextSettings(update, existing);
  await persistSettings(model, next, existing);
  applyDocument(next);
  return getEffectiveSettings();
}

function buildNextSettings(
  update: ApiSettingsUpdate,
  existing: SettingsDoc,
): SettingsDocument {
  return {
    scope:
      update.scope ??
      (existing && isRouteScope(existing.scope)
        ? existing.scope
        : DEFAULT_SCOPE),
    statisticsLifetime: resolveOverride(
      update.statisticsLifetime,
      existing?.statisticsLifetime,
    ),
    requestLogRetention: resolveOverride(
      update.requestLogRetention,
      existing?.requestLogRetention,
    ),
    requestSlownessThreshold: resolveOverride(
      update.requestSlownessThreshold,
      existing?.requestSlownessThreshold,
    ),
    requestLogMaxBodySize: resolveOverride(
      update.requestLogMaxBodySize,
      existing?.requestLogMaxBodySize,
    ),
  };
}

async function persistSettings(
  model: ApiSettingsModel,
  next: SettingsDocument,
  existing: SettingsDoc,
): Promise<void> {
  if (existing) {
    Object.assign(existing, next);
    await model.update(existing);
    return;
  }
  // Re-fetch to guard against a concurrent first-save race that would
  // create a duplicate singleton row.
  const raceCheck = await model.getSingleton();
  if (raceCheck) {
    Object.assign(raceCheck, next);
    await model.update(raceCheck);
  } else {
    await model.insert({ ...next, updatedAt: new Date() });
  }
}

/** `undefined` keeps the stored value, `null` clears it, a number sets it. */
function resolveOverride(
  incoming: number | null | undefined,
  stored: number | null | undefined,
): number | null {
  if (incoming === undefined) return stored ?? null;
  return incoming;
}
