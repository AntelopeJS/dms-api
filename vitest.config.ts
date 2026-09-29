import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Back-end unit tests. The front-end keeps its own config under frontend-vue/.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
