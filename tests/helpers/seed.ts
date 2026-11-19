import { randomUUID } from "node:crypto";
import { type Db, MongoClient } from "mongodb";
import { z } from "zod";
import type { Dms } from "./dms";
import type { Json } from "./json";

const MS_PER_DAY = 86_400_000;

async function withDatabase<T>(
  dms: Dms,
  body: (db: Db) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(dms.backend.mongoUrl);
  await client.connect();
  try {
    return await body(client.db(dms.backend.database));
  } finally {
    await client.close();
  }
}

/** The first millisecond of the local day `daysAgo` days back, how the module keys its per-day statistics. */
export function dayStart(daysAgo: number): number {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
  ).getTime();
}

/** Request logs `minutesAgo` or `daysAgo` old, one second apart, stored the way the capture stores them. */
export interface LogBatch {
  daysAgo?: number;
  minutesAgo?: number;
  count: number;
  method?: string;
  uri?: string;
  statusCode?: number;
  message?: string;
  requestBody?: string;
  responseBody?: string;
  responseTimeMs?: number;
}

/** Inserts request logs, as the capture stores them, with the user agent `seed`. */
export async function seedLogs(dms: Dms, batch: LogBatch): Promise<void> {
  const age =
    batch.minutesAgo === undefined
      ? (batch.daysAgo ?? 0) * MS_PER_DAY
      : batch.minutesAgo * 60_000;
  const rows = Array.from({ length: batch.count }, (_, index) => ({
    _id: randomUUID(),
    timestamp: new Date(Date.now() - age + index * 1000),
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
  await withDatabase(dms, (db) =>
    db.collection<{ _id: string }>("dms-api__request_log").insertMany(rows),
  );
}

/** A day of statistics of a route, `daysAgo` days back. */
export interface StatisticsDay {
  method: string;
  uri: string;
  daysAgo: number;
  requests: number;
  serverErrors?: number;
  clientErrors?: number;
  averageMs?: number;
}

/** Adds a day of statistics to a route. */
export async function seedStatistics(
  dms: Dms,
  day: StatisticsDay,
): Promise<void> {
  const average = day.averageMs ?? 10;
  const entry = {
    day: dayStart(day.daysAgo),
    requestsCount: day.requests,
    averageResponseTime: average,
    minResponseTime: average,
    maxResponseTime: average,
    totalResponseTime: average * day.requests,
    clientErrorsCount: day.clientErrors ?? 0,
    serverErrorsCount: day.serverErrors ?? 0,
    timedRequestsCount: day.requests,
    latencyHistogram: [day.requests, ...Array.from({ length: 17 }, () => 0)],
  };
  await withDatabase(dms, (db) =>
    db.collection<{ _id: string }>("dms-api__routes_statistics").updateOne(
      { _id: `${day.method}:${day.uri}` },
      {
        $push: { statistics: entry },
        $setOnInsert: {
          method: day.method,
          uri: day.uri,
          revision: randomUUID(),
          _instance: null,
        },
      },
      { upsert: true },
    ),
  );
}

/** The documents of a collection of the test's database that match `filter`, each parsed with `schema`. */
export async function readDocuments<T extends z.ZodTypeAny>(
  dms: Dms,
  collection: string,
  schema: T,
  filter: { [key: string]: Json } = {},
): Promise<z.infer<T>[]> {
  const documents = await withDatabase(dms, (db) =>
    db.collection(collection).find(filter).toArray(),
  );
  return z.array(schema).parse(documents);
}
