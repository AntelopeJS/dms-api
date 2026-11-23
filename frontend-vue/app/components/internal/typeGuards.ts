/** Whether a value is a string. */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Whether a value is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/** Whether a value is a non-null object or array. */
export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
