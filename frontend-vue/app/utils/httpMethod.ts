export type BadgeColor =
  | 'success'
  | 'primary'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'

// Shared HTTP verb -> semantic badge color for every method pill in the API
// pages (method badge, tester, logs list, log detail). Mirrors the backend's
// HTTP_METHOD_ICONS map so icon and color stay in sync, and keeps the four
// call sites from each re-deriving the same mapping.
const HTTP_METHOD_COLORS: Record<string, BadgeColor> = {
  GET: 'success',
  POST: 'primary',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'error',
  OPTIONS: 'info',
  HEAD: 'info',
}

export function httpMethodColor(method: string): BadgeColor {
  return HTTP_METHOD_COLORS[method.toUpperCase()] ?? 'neutral'
}

/** Verbs offered by the method filters (Logs toolbar, routes tree). */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * No-filter sentinel for the method/status/period selects. Not an empty string:
 * Reka-ui's SelectItem rejects those (an empty value clears the selection in
 * Nuxt UI), so the request builders strip this value instead.
 */
export const ANY_FILTER = 'any'

/**
 * Items for a method `<USelect>`, shared by the Logs toolbar and the routes
 * tree so the two filters can't drift. Verbs stay untranslated — they are
 * protocol tokens; only the "any" entry takes a label.
 */
export function httpMethodFilterItems(
  anyLabel: string,
): Array<{ value: string; label: string }> {
  return [
    { value: ANY_FILTER, label: anyLabel },
    ...HTTP_METHODS.map((method) => ({ value: method, label: method })),
  ]
}
