import type { Ref } from 'vue'

/** Cookie of the route last opened, for the browser session. */
const LAST_ROUTE_COOKIE = 'dms-api-last-route'

/**
 * The route last opened on the Routes page in this browser session. A
 * cookie, so the server reads it too: a visit naming no route lands on it
 * before the page renders (`middleware/defaultRoute.ts`).
 */
export function useLastRoute(): Ref<string | null> {
  return useDmsCookie<string | null>(LAST_ROUTE_COOKIE, {
    default: () => null,
    sameSite: 'lax',
  })
}
