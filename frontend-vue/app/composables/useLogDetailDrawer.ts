import { onUnmounted, ref } from 'vue'
import LogDetailDrawer from '../components/LogDetailDrawer.vue'
import type { RequestLogSummary } from './useApiIntrospection'

/**
 * Shared plumbing for every view that opens a request log in the right-hand
 * drawer (Logs, Overview, route Statistics): loading state, fetch-then-open,
 * and closing any drawer left open when the calling component unmounts — the
 * drawer is a global overlay, so it would otherwise outlive navigation.
 */
export function useLogDetailDrawer() {
  const { getLog } = useApiIntrospection()
  const { open: openDrawer } = useDrawer()

  const loadingDetailId = ref<string | null>(null)
  const openDrawers: Array<{ result: Promise<unknown>; close: () => void }> =
    []

  onUnmounted(() => {
    for (const drawer of openDrawers.splice(0)) {
      drawer.close()
    }
  })

  async function openLogDetail(summary: RequestLogSummary) {
    if (loadingDetailId.value === summary._id) return
    loadingDetailId.value = summary._id
    try {
      const full = await getLog(summary._id)
      const instance = openDrawer({
        title: `${summary.method.toUpperCase()} ${summary.uri}`,
        description: new Date(summary.timestamp).toLocaleString(),
        component: LogDetailDrawer,
        componentOptions: { log: full },
        direction: 'right',
      })
      openDrawers.push(instance)
      void instance.result.then(() => {
        const idx = openDrawers.indexOf(instance)
        if (idx >= 0) openDrawers.splice(idx, 1)
      })
    } catch (e) {
      console.error('[dms-api] failed to load log detail', e)
    } finally {
      loadingDetailId.value = null
    }
  }

  return { loadingDetailId, openLogDetail }
}
