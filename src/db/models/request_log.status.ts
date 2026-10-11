/** The status classes of the request logs, as the table's tabs filter them. */

export type RequestLogStatusClass = "success" | "client-error" | "server-error";

/** Inclusive-min / exclusive-max HTTP status ranges per status class. */
export const STATUS_CLASS_RANGES: Record<
  RequestLogStatusClass,
  { min: number; max?: number }
> = {
  success: { min: 200, max: 300 },
  "client-error": { min: 400, max: 500 },
  "server-error": { min: 500 },
};
