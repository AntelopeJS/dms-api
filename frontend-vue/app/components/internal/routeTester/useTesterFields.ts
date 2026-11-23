import { reactive, ref } from 'vue'
import {
  type BodyOrigin,
  type HistoryEntry,
  loadCommonHeaders,
  type ReplayInfo,
} from '../../../utils/testerHistory'
import type {
  BodyMode,
  CapturedRequest,
  KeyValue,
  TesterResult,
} from '../../../utils/testerRequest'
import type { CapturedState, Row, TesterSession } from './testerTypes'

/** The fields the tester edits, what it keeps of the call and the session that outlives its state. */
export function useTesterFields() {
  let nextRowId = 0
  const row = (name = '', value = ''): Row => ({ id: nextRowId++, name, value })
  const rows = (list: Row[]): KeyValue[] =>
    list.map(({ name, value }) => ({ name, value }))

  const bodyMode = ref<BodyMode>('none')
  const body = ref('')
  const form = reactive<Row[]>([])
  const headers = reactive<Row[]>([])
  const query = reactive<Row[]>([])
  const pathValues = reactive<Record<string, string>>({})
  const useSession = ref(true)
  const origin = ref<BodyOrigin>('example')
  const replayInfo = ref<ReplayInfo | null>(null)
  const result = ref<TesterResult | null>(null)
  const commonHeaders = reactive<Row[]>(
    loadCommonHeaders().map((entry) => row(entry.name, entry.value)),
  )
  const history = ref<HistoryEntry[]>([])
  const tab = ref('body')
  const responseTab = ref('body')
  const sending = ref(false)
  const capturedState = ref<CapturedState>('idle')
  const capturedLog = ref<CapturedRequest | null>(null)

  const session: TesterSession = {
    activeRef: null,
    inFlight: null,
    confirming: false,
    unmounted: false,
  }
  const filledRef = ref<string | null>(null)

  return {
    row,
    rows,
    bodyMode,
    body,
    form,
    headers,
    query,
    pathValues,
    useSession,
    origin,
    replayInfo,
    result,
    commonHeaders,
    history,
    tab,
    responseTab,
    sending,
    capturedState,
    capturedLog,
    filledRef,
    session,
  }
}
