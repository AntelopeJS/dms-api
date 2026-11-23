import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'
import defaultRoute from './app/middleware/defaultRoute'
import displays from './app/plugins/displays'

interface VueModule {
  default: Component
}

/**
 * The blocks the backend pages name (`CustomComponent("DmsApiRouteTree")`).
 * `components/internal` holds the pieces they are built from, imported by
 * path: they are not addressable from a page.
 */
const blocks = import.meta.glob<VueModule>('./app/components/blocks/*.vue')

/**
 * Registers the blocks and the cell displays, which are universal because the
 * request tables draw their cells in the server render too. The default-route
 * middleware makes the Routes page opened without a route land on one, on the
 * server too.
 */
const frontendModule: DmsFrontendModule = {
  componentPrefix: 'DmsApi',
  setup(sdk) {
    const byPath = Object.entries(blocks).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    for (const [path, loader] of byPath) {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.vue$/, '')
      sdk.registerComponent(
        name,
        defineAsyncComponent(async () => (await loader()).default),
      )
    }
    sdk.registerPlugin(displays, { clientOnly: false })
    sdk.registerMiddleware('dms-api-default-route', defaultRoute, {
      global: true,
    })
  },
}

export default frontendModule
