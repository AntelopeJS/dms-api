import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The journeys that call the API or run commands, against backends of the
 * e2e playground on a shared MongoDB. `pnpm e2e:build` builds what
 * they start.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.journeys.test.ts"],
    globalSetup: ["tests/helpers/journeys-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
