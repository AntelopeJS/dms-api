/**
 * Auth-middleware classification.
 *
 * AntelopeJS has no first-class notion of an "auth" middleware — anything
 * registered with @Prefix is just a function. To surface authentication
 * meaningfully on the Routes page we flag middleware whose callbackName
 * matches a configurable set of patterns (default: `auth_*`, `requireAuth*`,
 * `session_*`) or appears verbatim in an explicit allow-list. Both come
 * from {@link DmsApiConfig}, so projects can extend the defaults without
 * touching this module.
 */

import { getConfig } from "@/config";

interface CompiledMatcher {
  patterns: RegExp[];
  callbacks: Set<string>;
}

/** Any middleware descriptor carrying a callback name to classify. */
export interface AuthMiddlewareInput {
  callbackName: string;
}

let cached: CompiledMatcher | null = null;
let cachedSig = "";

function matcher(): CompiledMatcher {
  const cfg = getConfig();
  const sig = `${cfg.authMiddlewareNamePatterns.join("|")}::${cfg.authMiddlewareCallbacks.join("|")}`;
  if (cached && cachedSig === sig) return cached;

  const patterns: RegExp[] = [];
  for (const raw of cfg.authMiddlewareNamePatterns) {
    try {
      patterns.push(new RegExp(raw));
    } catch {
      // Bad config entry — skip silently so a single typo doesn't break
      // introspection for every other middleware.
    }
  }
  cached = {
    patterns,
    callbacks: new Set(cfg.authMiddlewareCallbacks),
  };
  cachedSig = sig;
  return cached;
}

export function isAuthMiddleware(m: AuthMiddlewareInput): boolean {
  const { patterns, callbacks } = matcher();
  if (callbacks.has(m.callbackName)) return true;
  return patterns.some((p) => p.test(m.callbackName));
}
