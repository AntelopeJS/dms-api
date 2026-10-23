import { useLastRoute } from '../composables/useLastRoute'
import {
  defaultRouteLocation,
  type ExplorerRoute,
  ROUTE_QUERY_KEY,
  ROUTES_PAGE_PATH,
} from '../utils/routeExplorer'

/** The list the Routes page's `RouteTree` reads (`src/pages/routes.ts`). */
const LIST_URL = '/api/monitoring/routes/list'

// A visit of the Routes page naming no route lands on one before the page
// renders: the last one opened in this browser session, else the one needing
// a look first. The server answers a reload with the address that names it,
// and a link followed in the browser goes straight there, so the header and
// the tabs render with the page rather than once the list has loaded.
// Without the list (signed out, a failed read), the page opens as it is.
export default defineDmsMiddleware(async (to) => {
  if (to.path !== ROUTES_PAGE_PATH || to.query[ROUTE_QUERY_KEY]) return
  if (!useDmsUserSession().loggedIn.value) return
  // Read before the request: the render's context is gone after an await.
  const last = useLastRoute().value
  const { $authFetch } = useAuthFetch()
  let routes: ExplorerRoute[]
  try {
    ;({ routes } = await $authFetch<{ routes: ExplorerRoute[] }>(LIST_URL))
  } catch {
    return
  }
  return defaultRouteLocation(to, routes, last)
})
