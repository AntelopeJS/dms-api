import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";

const preferredApiPort = process.env.PORT ?? "5010";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

/**
 * The module's options as JSON in `VERIFY_API_CONFIG`, set by a journey in
 * the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults.
 */
function apiConfig(): Record<string, unknown> {
  const text = process.env.VERIFY_API_CONFIG;
  return text ? JSON.parse(text) : {};
}

/**
 * The checkout's real folder. The run lays the checkout out again as links,
 * and the module's `@/` import alias applies to files under the folder the
 * source names, so the source names the files' real folder.
 */
const moduleRoot = dirname(realpathSync(resolve(__dirname, "../../../../package.json")));

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `dms-control` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-api",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-api": {
      source: { type: "local", path: moduleRoot },
      config: apiConfig(),
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.11.0 <1.0.0",
      },
      config: {
        homepage: "/modules/api/overview",
        meta: { title: "AntelopeJS API", description: "API console verification" },
        auth: {
          jwtSecret: process.env.DMS_JWT_SECRET ?? "dev",
          signInCountry: { database: false },
        },
        htmlRender: {
          serviceSecret: process.env.DMS_HTML_RENDER_SECRET ?? "dev",
          renderEndpoint: dmsClientUrl && `${dmsClientUrl}/api/html/render`,
        },
        apiBaseUrl: process.env.VERIFY_API_BASE_URL ?? "${@api.API_PUBLIC_BASE_URL}",
        clientBaseUrl: dmsClientUrl,
        frontend: { bootstrapSecret: process.env.DMS_BOOTSTRAP_SECRET },
        docsPreview: true,
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.5.0",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "verify_dms_api",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.3",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.1.13 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.6 <1.0.0",
      },
      config: {
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: { type: "local", path: process.env.VERIFY_API_PATH ?? "../api-module" },
      config: {
        servers: [{ protocol: "http", port: preferredApiPort }],
        publicBaseUrl: process.env.DMS_CLIENT_BASE_URL,
        cors: {
          allowedOrigins: [process.env.DMS_CLIENT_BASE_URL ?? "http://localhost:3001"],
        },
      },
    },
  },
});
