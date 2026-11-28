export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject

export interface JsonObject {
  [key: string]: JsonValue
}

export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isList(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

export function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  return (
    isObject(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(isString)
  )
}

export function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  const known: readonly unknown[] = values
  return known.includes(value)
}

/** Whether `value` is what `JSON.parse` can produce. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isString(value) || isNumber(value) || isBoolean(value))
    return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isObject(value) && Object.values(value).every(isJsonValue)
}
