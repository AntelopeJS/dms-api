import { HTTPResult } from "@antelopejs/interface-api";

/**
 * The translation keys the console's routes answer a 4xx refusal with. The
 * dashboard's error presenter shows a refusal only through a key its locales hold.
 */
export const REFUSALS = {
  logNotFound: "$api.refusals.log_not_found",
  routeNotFound: "$api.refusals.route_not_found",
  requestIdRequired: "$api.refusals.request_id_required",
  unknownRetentionField: "$api.refusals.unknown_retention_field",
  invalidRetentionDays: "$api.refusals.invalid_retention_days",
} as const;

/** One of the keys of {@link REFUSALS}. */
export type RefusalKey = (typeof REFUSALS)[keyof typeof REFUSALS];

/**
 * A refusal as the dashboard's error presenter reads it.
 *
 * @param status The HTTP status
 * @param message The refusal's key
 * @param params The values the sentence names
 * @returns The result to throw
 */
export function refusal(
  status: number,
  message: RefusalKey,
  params: Record<string, number | string> = {},
): HTTPResult {
  return new HTTPResult(status, { message, params, severity: "error" });
}

/**
 * Throws the refusal unless the condition holds.
 *
 * @param condition What must hold
 * @param status The HTTP status
 * @param message The refusal's key
 * @param params The values the sentence names
 */
export function ensure(
  condition: unknown,
  status: number,
  message: RefusalKey,
  params: Record<string, number | string> = {},
): asserts condition {
  if (!condition) throw refusal(status, message, params);
}
