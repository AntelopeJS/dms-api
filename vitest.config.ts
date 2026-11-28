import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testTimeouts } from "@antelopejs/tooling-configs/vitest";

/**
 * Back-end unit tests. The front-end keeps its own config under frontend-vue/,
 * and the journeys theirs in vitest.journeys.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  test: {
    ...testTimeouts,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.journeys.test.ts"],
  },
});
