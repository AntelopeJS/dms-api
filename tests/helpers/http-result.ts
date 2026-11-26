import type { HTTPResult } from "@antelopejs/interface-api";

/** Whether `value` answers like an `HTTPResult`, whichever copy of its package built it. */
export function isHttpResult(value: unknown): value is HTTPResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "getStatus" in value &&
    typeof value.getStatus === "function" &&
    "getBody" in value &&
    typeof value.getBody === "function" &&
    "getContentType" in value &&
    typeof value.getContentType === "function"
  );
}
