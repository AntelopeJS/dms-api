/** Whether `value` is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether `value` is a number, `NaN` and the infinities included. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether `value` is an object other than `null`: arrays included, functions not. */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** An object other than `null`, its `error` and `message`, present or not, read as `unknown`. */
export function isMessageBody(
  value: unknown,
): value is { error?: unknown; message?: unknown } {
  return typeof value === "object" && value !== null;
}

/** Whether a thrown value has a `getStatus` method, as an HTTPResult does. */
export function hasStatusGetter(
  value: unknown,
): value is { getStatus: unknown } {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "getStatus" in value &&
    typeof value.getStatus === "function"
  );
}
