import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Prettier formats the Vue layer; Markdown was never machine-formatted here; the journeys and their helpers keep the layout they had in the verify skill. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    "**/*.md",
    "**/*.vue",
    "e2e/journeys/**",
    "e2e/*.mjs",
    "e2e/*.cjs",
  ],
});
