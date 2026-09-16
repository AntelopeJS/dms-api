import { ValueProxy } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  RequestLog,
  REQUEST_LOG_ORDER_INDEX,
  requestLogTableName,
} from "../tables/request_log.table";

export type RequestLogStatusClass = "success" | "client-error" | "server-error";

export interface RequestLogFilters {
  routeId?: string;
  uri?: string;
  method?: string;
  statusClass?: RequestLogStatusClass;
  statusMin?: number;
  statusMax?: number;
  slowThresholdMs?: number;
  search?: string;
  since?: Date;
  until?: Date;
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

const DEFAULT_LIMIT = 50;
const CURSOR_SEPARATOR = "|";

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

/** Inclusive-min / exclusive-max HTTP status ranges per status class. */
const STATUS_CLASS_RANGES: Record<
  RequestLogStatusClass,
  { min: number; max?: number }
> = {
  success: { min: 200, max: 400 },
  "client-error": { min: 400, max: 500 },
  "server-error": { min: 500 },
};

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paginate(results: RequestLog[], limit: number): RequestLogPage {
  if (results.length > limit) {
    const trimmed = results.slice(0, limit);
    const last = trimmed[trimmed.length - 1];
    const nextCursor = `${last.timestamp.toISOString()}${CURSOR_SEPARATOR}${last._id}`;
    return { results: trimmed, nextCursor };
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
    let q = this.table.orderBy(REQUEST_LOG_ORDER_INDEX, "desc");
    q = this.applyScalarFilters(q, filters);
    q = this.applyStatusFilters(q, filters);
    const results = await q.slice(0, limit + 1).run();
    return paginate(results, limit);
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
      q = q.filter((doc) => doc.key("timestamp").le(until));
    }
    const routeId = filters.routeId;
    if (routeId) {
      q = q.filter((doc) => doc.key("routeId").eq(routeId));
    }
    const uri = filters.uri;
    if (uri) {
      q = q.filter((doc) => doc.key("uri").eq(uri));
    }
    if (filters.method) {
      const method = filters.method.toUpperCase();
      q = q.filter((doc) => doc.key("method").eq(method));
    }
    if (filters.search) {
      const needle = escapeRegex(filters.search);
      q = q.filter((doc) => doc.key("uri").match(`(?i)${needle}`));
    }
    const routeKeys = filters.routeKeys;
    if (routeKeys) {
      // Rebuild the `METHOD:uri` scope key inside the query so the scope is a
      // database predicate, not a post-filter: pagination then counts scoped
      // rows, and a page can never come back short (or empty with a cursor)
      // because unscoped traffic crowded the raw window out.
      q = q.filter((doc) =>
        ValueProxy.constant(routeKeys).includes(
          doc
            .key("method")
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
}
