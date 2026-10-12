import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  workspaces: {
    ".": antelopeKnipConfig({}),
    // The front end ships as source and is built by the DMS loader, which
    // supplies its `#dms*` aliases and Vite. The blocks are loaded through a
    // glob, the composables are auto-imported and the shortcuts registry is
    // found by convention, so all are entries.
    "frontend-vue": {
      entry: [
        "dms.frontend.build.ts",
        "app/config/shortcuts-registry.ts",
        "app/components/blocks/*.vue",
        "app/composables/*.ts",
      ],
      project: ["*.ts", "app/**/*.{ts,vue}"],
      ignoreUnresolved: ["^#dms", "^vite/client$"],
    },
  },
};
