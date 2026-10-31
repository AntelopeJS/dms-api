import type { JsonValue } from "@antelopejs/interface-dms/base/types/json";

/** Whether `value` is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether `value` is a number, `NaN` and the infinities included. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether `value` is a function. */
export function isFunction(value: unknown): value is Function {
  return typeof value === "function";
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

/** An object other than `null`, its `getBody` and `body`, present or not, read as `unknown`. */
export function isBodyCarrier(
  value: unknown,
): value is { getBody?: unknown; body?: unknown } {
  return typeof value === "object" && value !== null;
}

/** Whether a thrown value has a `getStatus` method, as an HTTPResult does. */
export function hasStatusGetter(
  value: unknown,
): value is { getStatus: Function } {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "getStatus" in value &&
    typeof value.getStatus === "function"
  );
}

/**
 * Whether `value` is JSON data, checked all the way down: what `JSON.parse`
 * returns. Only arrays and plain objects pass, so a `Date`, a `Map` or a class
 * instance does not. The walk keeps its own stack, so a document nested deeper
 * than the call stack allows is still answered.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || isString(current) || isNumber(current)) continue;
    if (typeof current === "boolean") continue;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isObject(current)) return false;
    const prototype: unknown = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const item of Object.values(current)) pending.push(item);
  }
  return true;
}

/** Whether `value` is a string or a Buffer: a body that is sent as bytes. */
export function isTextOrBuffer(value: unknown): value is string | Buffer {
  return typeof value === "string" || Buffer.isBuffer(value);
}

/** A body that can carry an error message: text, bytes, or an object with `error` or `message`. */
export function isErrorBody(
  value: unknown,
): value is string | Buffer | { error?: unknown; message?: unknown } {
  return isTextOrBuffer(value) || isMessageBody(value);
}
