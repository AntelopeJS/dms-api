import type {
  ComposedText,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base/types/composed-text";

/**
 * Texts the DMS blocks write in the reader's language (`ComposedText`): the
 * server sends the key and the values, the dashboard writes them.
 */

/** `api.<key>`, with its values. */
export function text(
  key: string,
  params?: Record<string, ComposedTextParam>,
): ComposedText {
  return params ? { key: `api.${key}`, params } : { key: `api.${key}` };
}

export function count(value: number): ComposedTextParam {
  return { type: "count", value };
}

export function number(value: number): ComposedTextParam {
  return { type: "number", value };
}

/**
 * A rate already in percent (`3.3`), as the DMS writes a percentage: "3.3%"
 * / "3,3 %".
 */
export function percent(value: number): ComposedTextParam {
  return { type: "number", value: value / 100, format: "percent" };
}

/** A duration in milliseconds, as "296 ms". */
export function milliseconds(value: number): ComposedText {
  return text("common.ms", { value: number(Math.round(value)) });
}
