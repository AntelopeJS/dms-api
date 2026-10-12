import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const requestLogTableName = "request_log";
export const REQUEST_LOG_ORDER_INDEX = "timestamp_id";

export interface RequestLogError {
  message: string;
  stack?: string;
}

/**
 * Why a body was not stored, so the console can say it instead of an empty
 * "no body":
 *  - `disabled`: body capture is off (maximum body size 0);
 *  - `too-large`: the request body went over the server's limit and was
 *    refused (413) before anything read it;
 *  - `not-json`: a type the capture cannot redact by key (text, XML, binary,
 *    multipart, a JSON scalar);
 *  - `malformed`: announced as JSON or a form, but did not parse;
 *  - `empty`: there was no body;
 *  - `not-read`: a body was sent, but the request was answered before any
 *    handler read it (unknown route, rejected by a guard).
 */
export type RequestLogBodyOmission =
  | "disabled"
  | "too-large"
  | "not-json"
  | "malformed"
  | "empty"
  | "not-read";

/**
 * Who sent a request, when it is not the API's own traffic: `tester` for a
 * request sent from the console's Tester. Such requests stay in the logs but
 * are kept out of the statistics, the health and Needs attention.
 */
export type RequestLogSource = "tester";

/** What the capture redacted from a request, section by section. */
export interface RequestLogRedactions {
  /** Query parameter values replaced by `[REDACTED]`. */
  query: number;
  /** Values replaced by `[REDACTED]` in the stored request body. */
  requestBody: number;
  /** Values replaced by `[REDACTED]` in the stored response body. */
  responseBody: number;
  /** Allow-listed headers left out because their name looks like a secret. */
  headers: string[];
}

@RegisterTable(requestLogTableName, SCHEMA_NAME)
export class RequestLog extends Table {
  // Leading field of the `timestamp_id` index, which also serves the plain
  // `timestamp` range filters (since/until, retention prune): no separate
  // single-field index.
  @Index({ group: REQUEST_LOG_ORDER_INDEX })
  @Field("date")
  declare timestamp: Date;

  @Index({ group: REQUEST_LOG_ORDER_INDEX })
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare method: string;

  /** Registered pattern of the matched handler (e.g. /api/users/:id);
   * falls back to the raw path when no route matched (404 etc.). */
  @Index()
  @Field("string")
  declare uri: string;

  /** Raw URL path as received. */
  @Field("string")
  declare rawPath: string;

  /** Route id from getRegisteredRoutes; null when no route matched (404 etc.). */
  @Index()
  @Field("string")
  declare routeId?: string;

  /**
   * Method of the route that served the request, when it differs from the
   * request's: `GET` for a HEAD answered by the GET handler, `ANY` for a
   * handler registered on every method. The route of a log is
   * `routeMethod ?? method` with `uri`.
   */
  @Field("string")
  declare routeMethod?: string;

  /** Who sent the request when it is not API traffic (see RequestLogSource). */
  @Field("string")
  declare source?: RequestLogSource;

  /** The request's `x-request-id` header, to find a request its sender knows. */
  @Index()
  @Field("string")
  declare requestId?: string;

  @Field("any")
  declare pathParams: Record<string, string>;

  @Field("any")
  declare query: Record<string, string | string[]>;

  @Field("any")
  declare requestHeaders: Record<string, string>;

  @Field("string")
  declare requestBody?: string;

  @Field("boolean")
  declare requestBodyTruncated: boolean;

  /** Why the request body was not stored; absent when it was. */
  @Field("string")
  declare requestBodyOmitted?: RequestLogBodyOmission;

  /** Bytes of the whole request body, when only its start is stored. */
  @Field("number")
  declare requestBodySize?: number;

  @Index()
  @Field("number")
  declare statusCode: number;

  /**
   * Time from the request entering the capture middleware to its response.
   * Null when it could not be measured: the request never reached a route
   * (unknown path), so no middleware stamped its start.
   */
  @Index()
  @Field("number")
  declare responseTimeMs: number | null;

  @Field("any")
  declare responseHeaders: Record<string, string>;

  @Field("string")
  declare responseBody?: string;

  @Field("boolean")
  declare responseBodyTruncated: boolean;

  /** Why the response body was not stored; absent when it was. */
  @Field("string")
  declare responseBodyOmitted?: RequestLogBodyOmission;

  /** Bytes of the whole response body, when only its start is stored. */
  @Field("number")
  declare responseBodySize?: number;

  /** What the capture redacted. */
  @Field("any")
  declare redactions: RequestLogRedactions;

  @Field("any")
  declare error?: RequestLogError;

  @Field("string")
  declare ip?: string;

  @Field("string")
  declare userAgent?: string;
}
