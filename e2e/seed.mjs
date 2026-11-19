import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isFunction, isRow, pick } from "./api.mjs";

/** @typedef {import("./api.mjs").Ctx} Ctx */

const MS_PER_DAY = 86_400_000;
const require = createRequire(fileURLToPath(import.meta.url));

/**
 * @typedef {{ insertMany: (rows: object[]) => Promise<unknown>, updateOne: (filter: object, update: object, options: { upsert: boolean }) => Promise<unknown>, find: (filter: object) => { toArray: () => Promise<unknown[]> } }} Collection
 * @typedef {{ collection: (name: string) => Collection }} Database
 * @typedef {{ connect: () => Promise<unknown>, close: () => Promise<unknown>, db: (name: string) => Database }} Client
 */

/**
 * @param {unknown} value Anything
 * @returns {value is Client} Whether it is a MongoDB client
 */
function isClient(value) {
  return isRow(value) && value.connect instanceof Function && value.close instanceof Function && value.db instanceof Function;
}

/**
 * The run's database through the MongoDB driver that mongodb-memory-server-core brings.
 *
 * @template T
 * @param {Ctx} ctx The journey
 * @param {(db: Database) => Promise<T>} body What to do with the database
 * @returns {Promise<T>} What `body` returned
 */
async function withDatabase(ctx, body) {
  /** @type {unknown} */
  const driver = createRequire(require.resolve("mongodb-memory-server-core"))("mongodb");
  const MongoClient = pick(driver, "MongoClient");
  /** @type {unknown} */
  const client = isFunction(MongoClient) ? Reflect.construct(MongoClient, [ctx.state.mongoUrl]) : undefined;
  if (!isClient(client)) throw new Error("the MongoDB driver has no MongoClient");
  await client.connect();
  try {
    return await body(client.db(ctx.state.database));
  } finally {
    await client.close();
  }
}

/**
 * Inserts request logs aged `daysAgo` days, the way the capture stores them, and keeps what was written as evidence.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the rows are
 * @param {{ daysAgo?: number, minutesAgo?: number, count: number, method?: string, uri?: string, statusCode?: number, message?: string, requestBody?: string, responseBody?: string, responseTimeMs?: number }} batch The rows, `minutesAgo` or `daysAgo` old
 * @returns {Promise<void>}
 */
export async function seedLogs(ctx, label, batch) {
  const rows = Array.from({ length: batch.count }, (_, index) => ({
    _id: randomUUID(),
    timestamp: new Date(Date.now() - (batch.minutesAgo === undefined ? (batch.daysAgo ?? 0) * MS_PER_DAY : batch.minutesAgo * 60_000) + index * 1000),
    method: batch.method ?? "GET",
    uri: batch.uri ?? "/fx/ok",
    rawPath: batch.uri ?? "/fx/ok",
    statusCode: batch.statusCode ?? 200,
    responseTimeMs: batch.responseTimeMs ?? 5,
    error: batch.message ? { message: batch.message } : null,
    routeId: null,
    routeMethod: null,
    source: null,
    requestId: null,
    ip: "::1",
    userAgent: "seed",
    pathParams: {},
    query: {},
    requestHeaders: {},
    requestBody: batch.requestBody ?? null,
    requestBodyTruncated: false,
    requestBodyOmitted: batch.requestBody === undefined ? "empty" : null,
    requestBodySize: null,
    responseHeaders: {},
    responseBody: batch.responseBody ?? null,
    responseBodyTruncated: false,
    responseBodyOmitted: batch.responseBody === undefined ? "empty" : null,
    responseBodySize: null,
    redactions: { query: 0, requestBody: 0, responseBody: 0, headers: [] },
    _instance: null,
  }));
  const folder = ctx.step(`seed logs ${label}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ batch, first: rows[0]?.timestamp }, null, 2)}\n`);
  await withDatabase(ctx, (db) => db.collection("dms-api__request_log").insertMany(rows));
}

