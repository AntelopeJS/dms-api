import { randomUUID } from "node:crypto";
import { getRegisteredRouteHandlers } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  MigrationModel,
  RequestLogModel,
  RouteModel,
  RouteStatisticsModel,
} from "@/db";
import { logCursor } from "@/db/models/request_log.model";
import type { RouteStatistics } from "@/db/tables/routes_statistics.table";
import {
  getRouteStatsKey,
  normalizeRoutePath,
} from "@/db/tables/routes_statistics.table";
import type { DayStatistics } from "@/types";
import {
  DMS_CONSOLE_PAGE_PREFIXES,
  isDmsConsoleCall,
  isDmsConsolePage,
  isInternalTraffic,
  registeredHandlers,
} from "./capture";
import { redactStoredBody } from "./redaction";

/**
 * What the passes read and rewrite. Narrowed to the calls they make, so a
 * test can hand in plain fakes.
 */
export interface MigrationModels {
  migrations: Pick<MigrationModel, "get" | "record">;
  logs: Pick<
    RequestLogModel,
    | "clearUnmeasuredDurations"
    | "renameUri"
    | "deleteByUri"
    | "deletePageLoads"
    | "bodiesMatching"
    | "replaceBodies"
  >;
  stats: Pick<
    RouteStatisticsModel,
    "get" | "getAll" | "insert" | "delete" | "replaceStatistics"
  >;
  routes: Pick<RouteModel, "getAll">;
  /** Locations of the registered handlers, as they were registered. */
  handlerLocations: () => string[];
  /**
   * Paths of the DMS console's own calls (see `isDmsConsoleCall`): the exact
   * paths of `DMS_CONSOLE_PATHS` and the DMS's handlers under
   * `DMS_CONSOLE_PATH_PREFIXES`.
   */
  dmsConsolePaths: () => string[];
}

function defaultModels(): MigrationModels {
  return {
    migrations: GetModel(MigrationModel),
    logs: GetModel(RequestLogModel),
    stats: GetModel(RouteStatisticsModel),
    routes: GetModel(RouteModel),
    handlerLocations: () =>
      getRegisteredRouteHandlers()
        .filter(({ handler }) => handler.mode === "handler")
        .map(({ handler }) => handler.location),
    dmsConsolePaths: () => {
      const handlers = registeredHandlers();
      return handlers
        .filter((handler) => isDmsConsoleCall(handler, () => handlers))
        .map((handler) => normalizeRoutePath(handler.location));
    },
  };
}

/** Rows a redaction pass reads per query. */
const REDACTION_BATCH = 500;

/**
 * Rows the redaction pass goes through in one start, at most. A pass cut
 * short records where it stopped and resumes at the next start, so a large
 * log never holds a start up for long.
 */
const REDACTION_ROWS_PER_RUN = 20_000;

/**
 * Bodies that may hold what the redaction rules now cover: card and bank
 * words in keys, the short keys matched as words, and digit runs that may be
 * card numbers. Wide on purpose: each candidate is checked in full by
 * {@link redactStoredBody}, and only the rows it changes are written.
 */
const REDACTION_CANDIDATE =
  '(?i)(?:card|cvc|cvv|cvn|iban)|(?:pin|ssn|pan)["=]|[2-6](?:[ -]?[0-9]){12,18}';

const MAX_MERGE_ATTEMPTS = 10;

/** Every known route path: handler locations, rollups and synced routes. */
async function knownRoutePaths(models: MigrationModels): Promise<Set<string>> {
  const [stats, routes] = await Promise.all([
    models.stats.getAll(),
    models.routes.getAll(),
  ]);
  return new Set([
    ...models.handlerLocations(),
    ...stats.map((route) => route.uri),
    ...routes.map((route) => route.uri),
  ]);
}

/**
 * Durations of 0 ms, written when the capture had no start time, become
 * "not measured".
 */
async function clearUnmeasuredDurations(models: MigrationModels) {
  return { durations: await models.logs.clearUnmeasuredDurations() };
}

/**
 * Logs and rollups of the console's own traffic, which is no longer captured
 * (see `isInternalTraffic`): left in place, they would keep the dashboard
 * showing itself.
 */
async function dropInternalTraffic(models: MigrationModels) {
  const paths = [...(await knownRoutePaths(models))].filter((path) =>
    isInternalTraffic(path),
  );
  const uris = new Set(
    paths.flatMap((path) => [path, normalizeRoutePath(path)]),
  );
  let logs = 0;
  for (const uri of uris) logs += await models.logs.deleteByUri(uri);
  const rollups = (await models.stats.getAll()).filter((route) =>
    isInternalTraffic(route.uri),
  );
  for (const route of rollups) await models.stats.delete(route._id);
  return { logs, rollups: rollups.length };
}

/**
 * Logs and rollups of the DMS console's own calls (the session check, the
 * notification badge, its Settings pages and their tables…), no longer
 * captured either (see `isDmsConsoleCall`). Run again by
 * `dms-console-endpoints` once the Settings endpoints joined the list: the
 * paths already dropped simply match nothing.
 */
async function dropDmsConsoleTraffic(models: MigrationModels) {
  const paths = new Set(models.dmsConsolePaths());
  let logs = 0;
  for (const path of paths) logs += await models.logs.deleteByUri(path);
  const rollups = (await models.stats.getAll()).filter((route) =>
    paths.has(normalizeRoutePath(route.uri)),
  );
  for (const route of rollups) await models.stats.delete(route._id);
  return { logs, rollups: rollups.length };
}

/** What `isDmsConsolePage` reads as a console page, as a stored `uri`. */
const CONSOLE_PAGE_PATTERN = `^/$|^(?:${DMS_CONSOLE_PAGE_PREFIXES.join("|")})(?:/|$)`;

/**
 * Logs of the DMS console's pages, loaded through its frontend by a client
 * other than a browser, no longer captured either (see `isDmsConsolePage`).
 * Only unanswered requests were: the paths a handler answers stay.
 */
async function dropDmsConsolePages(models: MigrationModels) {
  const answered = models
    .handlerLocations()
    .map(normalizeRoutePath)
    .filter((path) => isDmsConsolePage("GET", path));
  return {
    logs: await models.logs.deletePageLoads(CONSOLE_PAGE_PATTERN, [
      ...new Set(answered),
    ]),
  };
}

function mergeDays(
  into: DayStatistics[],
  from: DayStatistics[],
): DayStatistics[] {
  const byDay = new Map(into.map((day) => [day.day, { ...day }]));
  for (const day of from) {
    const existing = byDay.get(day.day);
    if (!existing) {
      byDay.set(day.day, { ...day });
      continue;
    }
    existing.requestsCount += day.requestsCount;
    existing.totalResponseTime += day.totalResponseTime;
    existing.averageResponseTime =
      existing.requestsCount > 0
        ? existing.totalResponseTime / existing.requestsCount
        : 0;
    existing.minResponseTime = Math.min(
      existing.minResponseTime,
      day.minResponseTime,
    );
    existing.maxResponseTime = Math.max(
      existing.maxResponseTime,
      day.maxResponseTime,
    );
    existing.clientErrorsCount += day.clientErrorsCount;
    existing.serverErrorsCount += day.serverErrorsCount;
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("duplicate key") ||
      error.message.includes("E11000"))
  );
}

/**
 * Move a rollup stored under a trailing-slash path to its canonical key,
 * merging it into the rollup the capture may already have started there. The
 * merge is guarded by the target's revision, like every rollup write.
 */
async function rekeyRollup(
  models: MigrationModels,
  route: RouteStatistics,
): Promise<void> {
  const uri = normalizeRoutePath(route.uri);
  const id = getRouteStatsKey(route.method, uri);
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    if (await mergeRollupInto(models, route, id, uri)) {
      await models.stats.delete(route._id);
      return;
    }
  }
  throw new Error(`Rollup ${id} kept changing concurrently; ${route._id} kept`);
}

/** One attempt at moving `route` under `id`; false when another write won. */
async function mergeRollupInto(
  models: MigrationModels,
  route: RouteStatistics,
  id: string,
  uri: string,
): Promise<boolean> {
  const target = await models.stats.get(id);
  if (!target) {
    try {
      await models.stats.insert({
        _id: id,
        method: route.method,
        uri,
        statistics: route.statistics,
        revision: randomUUID(),
      } as RouteStatistics);
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }
  target.statistics = mergeDays(target.statistics, route.statistics);
  return (await models.stats.replaceStatistics(target)) !== "not-applied";
}

/**
 * Route paths without their trailing slash (`GET /api/orders/` becomes
 * `GET /api/orders`), in the logs and the rollups: the capture writes them
 * that way now. The logs are renamed one known path at a time, through the
 * `uri` index.
 */
async function canonicalRoutePaths(models: MigrationModels) {
  let logs = 0;
  for (const path of await knownRoutePaths(models)) {
    const canonical = normalizeRoutePath(path);
    if (canonical !== path)
      logs += await models.logs.renameUri(path, canonical);
  }
  const rollups = (await models.stats.getAll()).filter(
    (route) => normalizeRoutePath(route.uri) !== route.uri,
  );
  for (const route of rollups) await rekeyRollup(models, route);
  return { logs, rollups: rollups.length };
}

/**
 * Bodies stored before card numbers, CVCs and IBANs were redacted, redacted
 * now by today's rules. Resumes from its cursor when a start ends it early.
 */
async function redactStoredBodies(
  models: MigrationModels,
  cursor: string | undefined,
): Promise<{ redacted: number; cursor?: string }> {
  let redacted = 0;
  for (let read = 0; read < REDACTION_ROWS_PER_RUN; read += REDACTION_BATCH) {
    const rows = await models.logs.bodiesMatching(
      REDACTION_CANDIDATE,
      cursor,
      REDACTION_BATCH,
    );
    for (const row of rows) {
      const bodies: { requestBody?: string; responseBody?: string } = {};
      for (const field of ["requestBody", "responseBody"] as const) {
        const text = row[field];
        if (!text) continue;
        const { value } = redactStoredBody(text);
        if (value !== text) bodies[field] = value;
      }
      if (Object.keys(bodies).length === 0) continue;
      await models.logs.replaceBodies(row._id, bodies);
      redacted++;
    }
    if (rows.length < REDACTION_BATCH) return { redacted };
    cursor = logCursor(rows[rows.length - 1]);
    await models.migrations.record(REDACTION_PASS, { cursor });
  }
  return { redacted, cursor };
}

const REDACTION_PASS = "card-redaction";

/** The passes, in order, by the name their row is recorded under. */
const PASSES: Array<
  [string, (models: MigrationModels) => Promise<Record<string, number>>]
> = [
  ["unmeasured-durations", clearUnmeasuredDurations],
  ["internal-traffic", dropInternalTraffic],
  ["canonical-route-paths", canonicalRoutePaths],
  ["dms-console-traffic", dropDmsConsoleTraffic],
  ["dms-console-pages", dropDmsConsolePages],
  ["dms-console-endpoints", dropDmsConsoleTraffic],
];

/**
 * Bring data stored by earlier versions in line with what the capture writes
 * now. Each pass runs once: its row in the `migrations` table records that it
 * completed. Every pass is idempotent, so one interrupted by a restart simply
 * runs again; each selects through an index or a bounded scan, so on a log of
 * a few hundred thousand requests the whole takes seconds, once.
 *
 * Meant to run in the background after the routes are synced at start:
 * `void migrateStoredData()`.
 */
export async function migrateStoredData(
  models: MigrationModels = defaultModels(),
): Promise<void> {
  for (const [id, pass] of PASSES) {
    if ((await models.migrations.get(id))?.completedAt) continue;
    const changed = await pass(models);
    await models.migrations.record(id, { completedAt: new Date() });
    Logging.Info(`[dms-api] migration ${id}:`, changed);
  }
  const redaction = await models.migrations.get(REDACTION_PASS);
  if (redaction?.completedAt) return;
  const { redacted, cursor } = await redactStoredBodies(
    models,
    redaction?.cursor,
  );
  await models.migrations.record(
    REDACTION_PASS,
    cursor ? { cursor } : { completedAt: new Date() },
  );
  Logging.Info(`[dms-api] migration ${REDACTION_PASS}:`, { redacted });
}
