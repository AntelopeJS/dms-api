import type { RequestContext } from "@antelopejs/interface-api";
import { getConfig } from "@/config";

/**
 * Where clients reach the API, for the cURL and fetch snippets the console
 * hands out: the module's `publicApiUrl` when it is set (wire it to the api
 * module's `${@api.API_PUBLIC_BASE_URL}`), else the origin this request
 * reached the API server on. Through the DMS frontend that is the API server
 * its proxy calls, never the frontend's own address, whose proxy refuses the
 * writes a copied command sends.
 */
export function apiOriginOf(context: Pick<RequestContext, "url">): string {
  const configured = getConfig().publicApiUrl?.trim();
  return (configured || context.url.origin).replace(/\/+$/, "");
}
