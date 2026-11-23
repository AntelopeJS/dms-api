import { computed } from 'vue'
import { parseRouteRef } from '../utils/http'

/**
 * The request the tester replays (`?replay=<id>`, `RouteTester.vue`). It
 * belongs to the route it was sent to: selecting another route drops it, so
 * the tester opens blank.
 */
const REPLAY_QUERY_KEY = 'replay'

export interface SelectOptions {
  /**
   * Replace the history entry instead of adding one: for a selection the
   * user did not ask for (the route a bare `/routes` opens on) and for the
   * keyboard, so Back leaves the page instead of walking every route seen.
   */
  replace?: boolean
}

/**
 * The route the Routes page shows, as `?route=METHOD%20/path` in the URL: a
 * link, a reload or the back button land on the same route, and every block
 * of the page reads the same value.
 */
export function useRouteSelection(queryKey = 'route') {
  const route = useDmsRoute()
  const router = useDmsRouter()

  const ref = computed<string | null>(() => {
    const value = route.query[queryKey]
    return value && !Array.isArray(value) ? value : null
  })
  const parsed = computed(() => parseRouteRef(ref.value))

  async function select(next: string | null, options: SelectOptions = {}) {
    if (next === ref.value) return
    const query = {
      ...route.query,
      [REPLAY_QUERY_KEY]: undefined,
      [queryKey]: next || undefined,
    }
    await (options.replace ? router.replace({ query }) : router.push({ query }))
  }

  return { ref, parsed, select }
}
