import { onBeforeUnmount } from 'vue'
import type { useTesterFlow } from './useTesterFlow'
import type { TesterState } from './useTesterState'

const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/**
 * The tester's keyboard and focus. Ctrl/Cmd+Enter sends from a field of the
 * tester only, never from the rest of the page; `send` still asks before a
 * write it has not confirmed. The page's live mode is held while the focus
 * stays in the tester and released once it leaves.
 */
export function useTesterFocus(
  tester: TesterState & ReturnType<typeof useTesterFlow>,
) {
  const { session, flushDraft, send } = tester
  const live = usePageLive()

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (event.isComposing) return
    event.preventDefault()
    void send()
  }

  function onFocusIn(event: FocusEvent) {
    const target = event.target
    if (target instanceof Element && target.closest(FIELD_SELECTOR))
      live.hold('$api.live_mode.typing_in_tester')
  }

  function onFocusOut(event: FocusEvent) {
    const root = event.currentTarget
    const next = event.relatedTarget
    if (root instanceof Node && next instanceof Node && root.contains(next))
      return
    live.release()
  }

  onBeforeUnmount(() => {
    flushDraft()
    session.unmounted = true
  })

  return { onKey, FIELD_SELECTOR, live, onFocusIn, onFocusOut }
}
