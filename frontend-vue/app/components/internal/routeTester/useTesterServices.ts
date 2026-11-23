import { useId } from 'vue'
import {
  createSourceTokens,
  TESTER_SOURCE_URL,
  type TesterSourceToken,
} from '../../../utils/testerRequest'
import type { RouteTesterProps } from './testerTypes'

/** The services the tester reads from the console: i18n, toasts, the session, the route and the API origin. */
export function useTesterServices(props: RouteTesterProps) {
  const { t } = useI18n()
  const { formatLocale: locale } = useRegionalFormat({ locale: 'format' })
  const dateFormat = useDateFormat()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { loggedIn } = useDmsUserSession()
  const currentRoute = useDmsRoute()
  const router = useDmsRouter()
  const { $authFetch } = useAuthFetch()
  const {
    data: route,
    pending,
    selection,
  } = useRouteDetail(props.fetchUrl, props.queryKey)
  const apiOrigin = useApiOrigin(() => route.value?.apiOrigin)
  const blockerId = useId()
  const sourceTokens = createSourceTokens(() =>
    $authFetch<TesterSourceToken>(TESTER_SOURCE_URL),
  )
  const bodyHintId = useId()

  return {
    dateFormat,
    toast,
    currentRoute,
    router,
    apiOrigin,
    blockerId,
    sourceTokens,
    bodyHintId,
    t,
    locale,
    confirm,
    loggedIn,
    $authFetch,
    route,
    pending,
    selection,
  }
}
