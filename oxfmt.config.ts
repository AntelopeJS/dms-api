import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier formats the Vue layer; Markdown was never machine-formatted here; the journeys, their helpers and their playground are hand-formatted. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    "**/*.md",
    "**/*.vue",
    "e2e/journeys/**",
    "e2e/playground/**",
    "e2e/*.mjs",
    "e2e/*.cjs",
  ],
});
