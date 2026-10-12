import { GetApiBaseUrl } from "@antelopejs/interface-dms/api-base-url";

/**
 * Where clients reach the API, for the cURL and fetch snippets the console
 * hands out: the DMS's public API origin (its `apiBaseUrl`), which the
 * monitored routes share since the DMS serves through the same API server.
 * Never the request's own origin, which a reverse proxy hides. Null when the
 * DMS configuration clears it: the snippets then write `$API_URL`.
 */
export async function apiOrigin(): Promise<string | null> {
  const base = (await GetApiBaseUrl())?.trim();
  return base ? base.replace(/\/+$/, "") : null;
}
