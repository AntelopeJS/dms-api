import { fileURLToPath } from 'node:url'
import { testTimeouts } from '@antelopejs/tooling-configs/vitest'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#dms-core': fileURLToPath(
        new URL(
          '../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core',
          import.meta.url,
        ),
      ),
      '#dms/server': fileURLToPath(
        new URL('./tests/stubs/server.ts', import.meta.url),
      ),
    },
  },
  test: {
    ...testTimeouts,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
