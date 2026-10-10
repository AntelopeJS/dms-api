import { computed } from 'vue'
import { parseRouteRef } from '../utils/http'

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
    return typeof value === 'string' && value ? value : null
  })
  const parsed = computed(() => parseRouteRef(ref.value))

  async function select(next: string | null) {
    if (next === ref.value) return
    const query: Record<string, string> = { ...route.query }
    if (next) query[queryKey] = next
    else delete query[queryKey]
    await router.push({ query })
  }

  return { ref, parsed, select }
}
