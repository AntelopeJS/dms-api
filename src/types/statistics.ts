export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestStatistics {
  responseTime: number;
  method: HttpMethod;
  uri: string;
  statusCode: number;
}

export interface DayStatistics {
  /** Timestamp at midnight (ms since epoch) */
  day: number;
  requestsCount: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  totalResponseTime: number;
  clientErrorsCount: number;
  serverErrorsCount: number;
}
