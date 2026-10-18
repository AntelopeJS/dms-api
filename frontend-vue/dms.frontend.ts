import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'
import defaultRoute from './app/middleware/defaultRoute'
import displays from './app/plugins/displays'

interface VueModule {
  default: Component
}

// The blocks the backend pages name (`CustomComponent("DmsApiRouteTree")`).
// `components/internal` holds the pieces they are built from, imported by
// path: they are not addressable from a page.
const blocks = import.meta.glob<VueModule>('./app/components/blocks/*.vue')

const frontendModule: DmsFrontendModule = {
  componentPrefix: 'DmsApi',
  setup(sdk) {
    for (const [path, loader] of Object.entries(blocks).sort()) {
      const name = path
        .split('/')
        .at(-1)!
        .replace(/\.vue$/, '')
      sdk.registerComponent(
        name,
        defineAsyncComponent(async () => (await loader()).default),
      )
    }
    // Universal: the request tables draw their cells in the server render too.
    sdk.registerPlugin(displays, { clientOnly: false })
    // The Routes page opened without a route lands on one, on the server too.
    sdk.registerMiddleware('dms-api-default-route', defaultRoute, {
      global: true,
    })
  },
}

export default frontendModule
