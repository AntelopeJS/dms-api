import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'
import displays from './app/plugins/displays'
import requestPanel from './app/plugins/requestPanel'
import { openRequestMiddleware } from './app/utils/requestDrawer'

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
    // The side panel a request opens in, docked on the right of the page
    // (`RequestDetail`). Universal: a reload renders it open in place.
    sdk.registerPlugin(requestPanel, { clientOnly: false })
    // A request table's row (`?record=`) opens its request in that panel,
    // over the page's own query, without a visit.
    sdk.registerMiddleware('dms-api-open-request', openRequestMiddleware, {
      global: true,
    })
  },
}

export default frontendModule
