import { ValueProxy } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { REQUEST_LOG_LIST_MAX_ROWS } from "../../types/constants";
import {
  escapeRegex,
  ID_PREFIX_END,
  requestIdPrefix,
  searchPattern,
} from "./request_log.search";

import {
  type RequestLogStatusClass,
  STATUS_CLASS_RANGES,
} from "./request_log.status";

export {
  pathEncoded,
  requestIdPrefix,
  searchPattern,
} from "./request_log.search";
export { type RequestLogStatusClass } from "./request_log.status";
import {
  RequestLog,
  REQUEST_LOG_ORDER_INDEX,
  requestLogTableName,
} from "../tables/request_log.table";
import { normalizeRoutePath } from "../tables/routes_statistics.table";

export interface RequestLogFilters {
  routeId?: string;
  uri?: string;
  /** The path exactly as requested: one resource of a route. */
  rawPath?: string;
  method?: string;
  /** Any of these request methods. */
  methods?: string[];
  /**
   * Method of the route the request reached (`routeMethod ?? method`): a
   * route filter, which keeps a HEAD served by the GET handler on its GET
   * route.
   */
  routeMethod?: string;
  /** Substring of the error message, case-insensitive. */
  errorMessage?: string;
  statusClass?: RequestLogStatusClass;
  statusMin?: number;
  statusMax?: number;
  slowThresholdMs?: number;
  search?: string;
  /** The request's own `x-request-id`. */
  requestId?: string;
  since?: Date;
  /**
   * Strictly before this instant: windows are half-open, `[since, until)`,
   * so two adjacent windows never count the same request twice.
   */
  until?: Date;
  /** Strictly after this instant: what arrived since a live view's cursor. */
  after?: Date;
  /**
   * API traffic only: leaves out the requests a source marked (the Tester's),
   * as the statistics and the health do. The request table keeps them.
   */
  apiTrafficOnly?: boolean;
  /** The Tester's requests only. */
  testerOnly?: boolean;
  cursor?: string;
  limit?: number;
  /**
   * Route scope: `METHOD:uri` keys the result is restricted to (see
   * `getScopedRouteKeys`). Absent means no scope filtering; an empty list
   * matches nothing, which is what an empty scope should return.
   */
  routeKeys?: string[];
}

export interface RequestLogPage {
  results: RequestLog[];
  nextCursor: string | null;
}

/**
 * The fields a request table row is built from, read without the bodies,
 * and of the error its message alone: a stack weighs kilobytes, times the
 * thousands of rows a table holds after a few "Load more".
 */
export type RequestLogListItem = Pick<
  RequestLog,
  | "_id"
  | "timestamp"
  | "method"
  | "uri"
  | "rawPath"
  | "statusCode"
  | "responseTimeMs"
  | "ip"
  | "routeMethod"
  | "source"
  | "requestId"
> & { errorMessage?: string | null };

/** One page of a filtered listing, with the number of matching rows. */
export interface RequestLogListPage {
  results: RequestLogListItem[];
  total: number;
}

/** The rows that arrived after a live view's cursor, newest first. */
export interface RequestLogSincePage {
  results: RequestLogListItem[];
  /**
   * Every matching API request after the cursor, beyond the `limit` returned
   * too; the Tester's are counted apart, in `tester`.
   */
  count: number;
  /** Of `count`, the ones answered with a 5xx. */
  serverErrors: number;
  /** Matching requests the Tester sent after the cursor. */
  tester: number;
}

/** Columns a listing can be sorted on, each backed by an index. */
export type RequestLogSortKey = "timestamp" | "statusCode" | "responseTimeMs";

export interface RequestLogListOptions {
  offset?: number;
  limit?: number;
  sortKey?: RequestLogSortKey;
  sortDirection?: "asc" | "desc";
}

/**
 * The few fields the aggregations read, projected so a window of traffic can
 * be scanned in one query without carrying headers and bodies along.
 */
export interface RequestLogSample {
  timestamp: Date;
  /** Method of the route the request reached (`routeMethod ?? method`). */
  method: string;
  uri: string;
  statusCode: number;
  /** Null when the duration was not measured (see `RequestLog`). */
  responseTimeMs: number | null;
  errorMessage?: string;
}

const DEFAULT_LIMIT = 50;
/** `source` of a request the console's Tester sent. */
const TESTER_SOURCE = "tester";
const CURSOR_SEPARATOR = "|";
const SERVER_ERROR_MIN = 500;

interface LogCursor {
  timestamp: Date;
  id?: string;
}

function decodeCursor(raw?: string): LogCursor | undefined {
  if (!raw) return undefined;
  const separator = raw.indexOf(CURSOR_SEPARATOR);
  const date = separator < 0 ? raw : raw.slice(0, separator);
  const id = separator < 0 ? undefined : raw.slice(separator + 1);
  const timestamp = new Date(date);
  if (Number.isNaN(+timestamp) || id === "") return undefined;
  return { timestamp, id };
}

/** Largest page {@link RequestLogModel.query} will return, scoped or not. */
export const REQUEST_LOG_MAX_LIMIT = 200;

/** The cursor of a log: listings resume past it, newest first. */
export function logCursor(log: Pick<RequestLog, "_id" | "timestamp">): string {
  return `${log.timestamp.toISOString()}${CURSOR_SEPARATOR}${log._id}`;
}

function paginate(results: RequestLog[], limit: number): RequestLogPage {
  if (results.length > limit) {
    const trimmed = results.slice(0, limit);
    return {
      results: trimmed,
      nextCursor: logCursor(trimmed[trimmed.length - 1]),
    };
  }
  return { results, nextCursor: null };
}

export class RequestLogModel extends BasicDataModel(
  RequestLog,
  requestLogTableName,
) {
  async query(filters: RequestLogFilters): Promise<RequestLogPage> {
    const limit = Math.min(
      filters.limit ?? DEFAULT_LIMIT,
      REQUEST_LOG_MAX_LIMIT,
    );
    const q = this.applyFilters(
      this.table.orderBy(REQUEST_LOG_ORDER_INDEX, "desc"),
      filters,
    );
    const results = await q.slice(0, limit + 1).run();
    return paginate(results, limit);
  }

  /**
   * One page of the rows matching `filters`, by offset, with their total:
   * what a table view over the logs pages through, and counts its tabs with. The DMS table loads more rows by asking for a larger page from
   * the first row, so the page goes up to `REQUEST_LOG_LIST_MAX_ROWS`.
   */
  async list(
    filters: RequestLogFilters,
    options: RequestLogListOptions,
  ): Promise<RequestLogListPage> {
    const limit = Math.min(
      options.limit ?? DEFAULT_LIMIT,
      REQUEST_LOG_LIST_MAX_ROWS,
    );
    const offset = Math.max(0, options.offset ?? 0);
    const sortKey = options.sortKey ?? "timestamp";
    const index = sortKey === "timestamp" ? REQUEST_LOG_ORDER_INDEX : sortKey;
    const ordered = this.applyFilters(
      this.table.orderBy(index, options.sortDirection ?? "desc"),
      filters,
    );
    const [results, total] = await Promise.all([
      // A limit of 0 asks for the total alone: a slice of 0 rows would read
      // as "no limit" to the database.
      limit > 0 ? this.listItems(ordered.slice(offset, offset + limit)) : [],
      this.applyFilters(this.table, filters).count().run(),
    ]);
    return { results, total };
  }

  /**
   * The rows matching `filters` that arrived after `after`, newest first, up
   * to `limit` (none for 0: a live view counting what it misses), and how
   * many there are in all: the API's, its 5xx among them, and the Tester's.
   */
  async since(
    filters: RequestLogFilters,
    after: Date,
    limit: number,
  ): Promise<RequestLogSincePage> {
    const window = { ...filters, after };
    const [results, byStatus, tester] = await Promise.all([
      // A slice of 0 rows would read as "no limit" to the database.
      limit > 0
        ? this.listItems(
            this.applyFilters(
              this.table.orderBy(REQUEST_LOG_ORDER_INDEX, "desc"),
              window,
            ).slice(0, limit),
          )
        : [],
      this.countByStatus({ ...window, apiTrafficOnly: true }),
      this.applyFilters(this.table, { ...window, testerOnly: true })
        .count()
        .run(),
    ]);
    let count = 0;
    let serverErrors = 0;
    for (const [status, rows] of byStatus) {
      count += rows;
      if (status >= SERVER_ERROR_MIN) serverErrors += rows;
    }
    return { results, count, serverErrors, tester };
  }

  /** Every row matching `filters`, reduced to the fields aggregations read. */
  async samples(filters: RequestLogFilters): Promise<RequestLogSample[]> {
    // The Tester's requests are logged, not counted (see RequestLogSource).
    return this.applyFilters(this.table, { ...filters, apiTrafficOnly: true })
      .map((doc) => ({
        timestamp: doc.key("timestamp"),
        method: doc.key("routeMethod").default(doc.key("method")),
        uri: doc.key("uri"),
        statusCode: doc.key("statusCode"),
        responseTimeMs: doc.key("responseTimeMs"),
        errorMessage: doc.key("error").default(null).key("message"),
      }))
      .run() as Promise<RequestLogSample[]>;
  }

  /** The matching rows per status code, in one pass. */
  private async countByStatus(
    filters: RequestLogFilters,
  ): Promise<Map<number, number>> {
    const groups = (await this.applyFilters(this.table, filters)
      .group("statusCode", (stream, statusCode) => ({
        statusCode,
        count: stream.count(),
      }))
      .run()) as Array<{ statusCode: number; count: number }>;
    return new Map(groups.map((group) => [group.statusCode, group.count]));
  }

  private listItems(rows: this["table"]): Promise<RequestLogListItem[]> {
    return rows
      .map((doc) => ({
        _id: doc.key("_id"),
        timestamp: doc.key("timestamp"),
        method: doc.key("method"),
        uri: doc.key("uri"),
        rawPath: doc.key("rawPath"),
        statusCode: doc.key("statusCode"),
        responseTimeMs: doc.key("responseTimeMs"),
        errorMessage: doc.key("error").default(null).key("message"),
        ip: doc.key("ip"),
        routeMethod: doc.key("routeMethod"),
        source: doc.key("source"),
        requestId: doc.key("requestId"),
      }))
      .run() as Promise<RequestLogListItem[]>;
  }

  private applyFilters(
    q: this["table"],
    filters: RequestLogFilters,
  ): this["table"] {
    return this.applyStatusFilters(
      this.applySearch(this.applyScalarFilters(q, filters), filters),
      filters,
    );
  }

  private applyScalarFilters(
    q: this["table"],
    filters: RequestLogFilters,
  ): this["table"] {
    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      q = q.filter((doc) => {
        const older = doc.key("timestamp").lt(cursor.timestamp);
        return cursor.id === undefined
          ? older
          : older.or(
              doc
                .key("timestamp")
                .eq(cursor.timestamp)
                .and(doc.key("_id").lt(cursor.id)),
            );
      });
    }
    const since = filters.since;
    if (since) {
      q = q.filter((doc) => doc.key("timestamp").ge(since));
    }
    const until = filters.until;
    if (until) {
      q = q.filter((doc) => doc.key("timestamp").lt(until));
    }
    const after = filters.after;
    if (after) {
      q = q.filter((doc) => doc.key("timestamp").gt(after));
    }
    if (filters.apiTrafficOnly) {
      q = q.filter((doc) => doc.key("source").default("").eq(""));
    }
    if (filters.testerOnly) {
      q = q.filter((doc) => doc.key("source").default("").eq(TESTER_SOURCE));
    }
    const routeId = filters.routeId;
    if (routeId) {
      q = q.filter((doc) => doc.key("routeId").eq(routeId));
    }
    if (filters.uri) {
      // Stored paths are canonical: a handler location with its trailing
      // slash names the same route.
      const uri = normalizeRoutePath(filters.uri);
      q = q.filter((doc) => doc.key("uri").eq(uri));
    }
    if (filters.method) {
      const method = filters.method.toUpperCase();
      q = q.filter((doc) => doc.key("method").eq(method));
    }
    if (filters.methods) {
      const methods = filters.methods.map((method) => method.toUpperCase());
      q = q.filter((doc) =>
        ValueProxy.constant(methods).includes(doc.key("method").cast<string>()),
      );
    }
    if (filters.routeMethod) {
      const method = filters.routeMethod.toUpperCase();
      q = q.filter((doc) =>
        doc.key("routeMethod").default(doc.key("method")).eq(method),
      );
    }
    const rawPath = filters.rawPath;
    if (rawPath) {
      q = q.filter((doc) => doc.key("rawPath").eq(rawPath));
    }
    const requestId = filters.requestId;
    if (requestId) {
      q = q.filter((doc) => doc.key("requestId").eq(requestId));
    }
    if (filters.errorMessage) {
      const pattern = `(?i)${escapeRegex(filters.errorMessage)}`;
      q = q.filter((doc) =>
        doc
          .key("error")
          .default(null)
          .key("message")
          .default("")
          .match(pattern),
      );
    }
    const routeKeys = filters.routeKeys;
    if (routeKeys) {
      // Rebuild the `METHOD:uri` scope key inside the query so the scope is a
      // database predicate, not a post-filter: pagination then counts scoped
      // rows, and a page can never come back short (or empty with a cursor)
      // because unscoped traffic crowded the raw window out. The method is
      // the route's: a HEAD served by the GET handler is in the GET route's
      // scope.
      q = q.filter((doc) =>
        ValueProxy.constant(routeKeys).includes(
          doc
            .key("routeMethod")
            .default(doc.key("method"))
            .cast<string>()
            // Capture already uppercases the method, but the keys are built
            // uppercase too — normalize so a row written by an older build
            // can't fall out of its own scope.
            .upcase()
            .concat(":")
            .concat(doc.key("uri")),
        ),
      );
    }
    return q;
  }

  /**
   * A request id, or its first digits, is looked up on the `_id` index. Any
   * other search scans the rows for the path (as typed or as stored,
   * percent-encoded) and the error message: the database cannot use an
   * index for a substring, so the period filter is what keeps it short.
   */
  private applySearch(
    q: this["table"],
    filters: RequestLogFilters,
  ): this["table"] {
    if (!filters.search) return q;
    const prefix = requestIdPrefix(filters.search);
    if (prefix) {
      return q.filter((doc) =>
        doc
          .key("_id")
          .ge(prefix)
          .and(doc.key("_id").lt(`${prefix}${ID_PREFIX_END}`)),
      );
    }
    const pattern = searchPattern(filters.search);
    return q.filter((doc) =>
      doc
        .key("rawPath")
        .match(pattern)
        .or(
          doc
            .key("error")
            .default(null)
            .key("message")
            .default("")
            .match(pattern),
        ),
    );
  }

  private applyStatusFilters(
    q: this["table"],
    filters: RequestLogFilters,
  ): this["table"] {
    if (filters.statusClass) {
      const { min, max } = STATUS_CLASS_RANGES[filters.statusClass];
      q = q.filter((doc) => {
        const lower = doc.key("statusCode").ge(min);
        return max === undefined
          ? lower
          : lower.and(doc.key("statusCode").lt(max));
      });
    }
    const statusMin = filters.statusMin;
    if (statusMin !== undefined) {
      q = q.filter((doc) => doc.key("statusCode").ge(statusMin));
    }
    const statusMax = filters.statusMax;
    if (statusMax !== undefined) {
      q = q.filter((doc) => doc.key("statusCode").le(statusMax));
    }
    const slowThresholdMs = filters.slowThresholdMs;
    if (slowThresholdMs !== undefined) {
      q = q.filter((doc) => doc.key("responseTimeMs").ge(slowThresholdMs));
    }
    return q;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.table
      .filter((doc) => doc.key("timestamp").lt(cutoff))
      .delete()
      .run();
  }

  // Maintenance of logs stored by earlier versions (see `migrate.ts`). Each
  // selects through an index, so it costs what it changes.

  /**
   * Durations of exactly 0 ms: an earlier capture wrote 0 when it had no
   * start time. A measured duration is never exactly 0 (nanosecond clock).
   */
  async clearUnmeasuredDurations(): Promise<number> {
    return this.table
      .filter((doc) => doc.key("responseTimeMs").eq(0))
      .update({ responseTimeMs: null })
      .run();
  }

  async renameUri(from: string, to: string): Promise<number> {
    return this.table
      .filter((doc) => doc.key("uri").eq(from))
      .update({ uri: to })
      .run();
  }

  async deleteByUri(uri: string): Promise<number> {
    return this.table
      .filter((doc) => doc.key("uri").eq(uri))
      .delete()
      .run();
  }

  /**
   * The page loads (`GET`, `HEAD`) whose path matches `pattern`, but for the
   * paths in `kept`, which a handler answers: a scan, run once.
   */
  async deletePageLoads(pattern: string, kept: string[]): Promise<number> {
    return this.table
      .filter((doc) =>
        kept.reduce(
          (selected, uri) => selected.and(doc.key("uri").ne(uri)),
          doc
            .key("uri")
            .match(pattern)
            .and(doc.key("method").eq("GET").or(doc.key("method").eq("HEAD"))),
        ),
      )
      .delete()
      .run();
  }

  /**
   * Up to `limit` logs past `cursor` (newest first, see {@link logCursor})
   * whose stored bodies match `pattern`, with just what a redaction pass
   * rewrites.
   */
  async bodiesMatching(
    pattern: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<StoredBodies[]> {
    return this.applyScalarFilters(
      this.table.orderBy(REQUEST_LOG_ORDER_INDEX, "desc"),
      { cursor },
    )
      .filter((doc) =>
        doc
          .key("requestBody")
          .default("")
          .match(pattern)
          .or(doc.key("responseBody").default("").match(pattern)),
      )
      .slice(0, limit)
      .map((doc) => ({
        _id: doc.key("_id"),
        timestamp: doc.key("timestamp"),
        requestBody: doc.key("requestBody"),
        responseBody: doc.key("responseBody"),
      }))
      .run() as Promise<StoredBodies[]>;
  }

  async replaceBodies(
    id: string,
    bodies: Partial<Pick<RequestLog, "requestBody" | "responseBody">>,
  ): Promise<void> {
    await this.table.get(id).update(bodies).run();
  }
}

/** A log's stored bodies, as a redaction pass reads them. */
export type StoredBodies = Pick<
  RequestLog,
  "_id" | "timestamp" | "requestBody" | "responseBody"
>;
