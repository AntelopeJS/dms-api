import type { JsonValue } from "@antelopejs/interface-dms/base/types/json";

/**
 * What `@JSONBody()` hands a route: the request body through `JSON.parse`,
 * `undefined` for an empty body.
 */
export type JsonBody = JsonValue | undefined;
