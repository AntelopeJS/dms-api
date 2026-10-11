<script setup lang="ts">
import { onMounted } from 'vue'

// The module's own address (`/modules/api`): draws nothing and sends to the
// module's landing page, with the query it was opened with
// (`/modules/api?live=0` opens the Overview paused). In the server render
// the navigation becomes the response's redirect; in the browser (the
// breadcrumb's "API") it replaces this page in the history, so Back does not
// land here again, and keeps the hash too.
defineOptions({ inheritAttrs: false })

const props = defineProps<{ to: string }>()
const route = useDmsRoute()

/** The landing page, with the query and hash of `from` (a path or a search). */
function landingTarget(from: string): string {
  const start = from.search(/[?#]/)
  return start < 0 ? props.to : props.to + from.slice(start)
}

onMounted(() => {
  void navigateDms(
    landingTarget(window.location.search + window.location.hash),
    { replace: true },
  )
})
if (import.meta.env.SSR)
  await navigateDms(landingTarget(route.fullPath), { replace: true })
</script>

<template>
  <div aria-hidden="true" />
</template>
