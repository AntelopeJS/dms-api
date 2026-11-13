import { isObject, isTextOrBuffer } from "@/guards";

/**
 * A body as a handler set it or a client sent it, sorted once by what the log
 * can do with it: nothing, text or bytes, an object to serialise, or a value
 * of another kind (a number, a function) that has no stored form.
 */
export type BodyValue =
  | { kind: "none" }
  | { kind: "text"; raw: string | Buffer }
  | { kind: "data"; data: object }
  | { kind: "other" };

/** No body: `undefined`, `null`, or none to read. */
export const NO_BODY: BodyValue = { kind: "none" };

/** The kind of body `value` is: `undefined` and `null` carry none. */
export function parseBody(value: unknown): BodyValue {
  if (isTextOrBuffer(value)) return { kind: "text", raw: value };
  if (isObject(value)) return { kind: "data", data: value };
  if (value === undefined || value === null) return NO_BODY;
  return { kind: "other" };
}

/** The text of a body given as text or as UTF-8 bytes. */
export function bodyText(raw: string | Buffer): string {
  return Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
}
