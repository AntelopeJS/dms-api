/**
 * The status classes of the request logs, and the tab counts (All, 2xx, 4xx,
 * 5xx) built from the per-status counts of a filter set. Pure.
 */

export type RequestLogStatusClass = "success" | "client-error" | "server-error";

/** Matching rows by status tab: every row, then 2xx, 4xx and 5xx. */
export interface RequestLogCounts {
  all: number;
  "2xx": number;
  "4xx": number;
  "5xx": number;
}

/** Inclusive-min / exclusive-max HTTP status ranges per status class. */
export const STATUS_CLASS_RANGES: Record<
  RequestLogStatusClass,
  { min: number; max?: number }
> = {
  success: { min: 200, max: 400 },
  "client-error": { min: 400, max: 500 },
  "server-error": { min: 500 },
};

const COUNTED_CLASSES: Record<
  Exclude<keyof RequestLogCounts, "all">,
  RequestLogStatusClass
> = {
  "2xx": "success",
  "4xx": "client-error",
  "5xx": "server-error",
};

function inStatusClass(status: number, statusClass: RequestLogStatusClass) {
  const { min, max } = STATUS_CLASS_RANGES[statusClass];
  return status >= min && (max === undefined || status < max);
}

export function sumStatuses(
  byStatus: Map<number, number>,
  statusClass: RequestLogStatusClass,
): number {
  let sum = 0;
  for (const [status, count] of byStatus) {
    if (inStatusClass(status, statusClass)) sum += count;
  }
  return sum;
}

/** The tab counts from the per-status counts. */
export function countTabs(byStatus: Map<number, number>): RequestLogCounts {
  let all = 0;
  for (const count of byStatus.values()) all += count;
  return {
    all,
    "2xx": sumStatuses(byStatus, COUNTED_CLASSES["2xx"]),
    "4xx": sumStatuses(byStatus, COUNTED_CLASSES["4xx"]),
    "5xx": sumStatuses(byStatus, COUNTED_CLASSES["5xx"]),
  };
}
