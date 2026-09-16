import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import type { HttpMethod } from "@/types";
import { SCHEMA_NAME } from "../../types/constants";

export const requestLogTableName = "request_log";
export const REQUEST_LOG_ORDER_INDEX = "timestamp_id";

export interface RequestLogError {
  message: string;
  stack?: string;
}

@RegisterTable(requestLogTableName, SCHEMA_NAME)
export class RequestLog extends Table {
  @Index({ group: REQUEST_LOG_ORDER_INDEX })
  @Index()
  @Field("date")
  declare timestamp: Date;

  @Index({ group: REQUEST_LOG_ORDER_INDEX })
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare method: HttpMethod;

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

  @Index()
  @Field("number")
  declare statusCode: number;

  @Index()
  @Field("number")
  declare responseTimeMs: number;

  @Field("any")
  declare responseHeaders: Record<string, string>;

  @Field("string")
  declare responseBody?: string;

  @Field("boolean")
  declare responseBodyTruncated: boolean;

  @Field("any")
  declare error?: RequestLogError;

  @Field("string")
  declare ip?: string;

  @Field("string")
  declare userAgent?: string;
}
