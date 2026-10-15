import { defineDmsServer } from '#dms/server'
import { testerMethodNotAllowed, testerRoute } from './server/tester'

// The API tester's call forwarding: served by this module, under its own
// namespace, rather than by every deployment's frontend server.
export default defineDmsServer((server) => {
  server.registerRoute('POST', '/api/_dms-api/tester', testerRoute)
  server.registerRoute(
    ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    '/api/_dms-api/tester',
    testerMethodNotAllowed,
    { sameOrigin: false },
  )
})
