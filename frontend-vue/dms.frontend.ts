import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms-inertia/frontend-module'

interface VueModule {
  default: Component
}

const components = import.meta.glob<VueModule>('./app/components/**/*.vue')

const frontendModule: DmsFrontendModule = {
  setup(sdk) {
    for (const [path, loader] of Object.entries(components).sort()) {
      const name = path
        .split('/')
        .at(-1)!
        .replace(/\.vue$/, '')
      sdk.registerComponent(
        `DmsApi${name}`,
        defineAsyncComponent(async () => (await loader()).default),
      )
    }
  },
}

export default frontendModule
