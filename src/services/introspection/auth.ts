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

/**
 * The auth patterns and callbacks of the configuration, compiled once per
 * configuration. A pattern that is not a valid regex is skipped silently, so
 * a single typo doesn't break introspection for every other middleware.
 */
function matcher(): CompiledMatcher {
  const cfg = getConfig();
  const sig = `${cfg.authMiddlewareNamePatterns.join("|")}::${cfg.authMiddlewareCallbacks.join("|")}`;
  if (cached && cachedSig === sig) return cached;

  const patterns: RegExp[] = [];
  for (const raw of cfg.authMiddlewareNamePatterns) {
    try {
      patterns.push(new RegExp(raw));
    } catch {}
  }
  cached = {
    patterns,
    callbacks: new Set(cfg.authMiddlewareCallbacks),
  };
  cachedSig = sig;
  return cached;
}

/**
 * Whether a middleware is an auth middleware. AntelopeJS has no first-class
 * notion of one: anything registered with @Prefix is just a function. The
 * Routes page flags a middleware whose callbackName matches a configurable set
 * of patterns (default: `auth_*`, `requireAuth*`, `session_*`) or appears
 * verbatim in an explicit allow-list. Both come from {@link DmsApiConfig}, so
 * projects extend the defaults without touching this module.
 */
export function isAuthMiddleware(m: AuthMiddlewareInput): boolean {
  const { patterns, callbacks } = matcher();
  if (callbacks.has(m.callbackName)) return true;
  return patterns.some((p) => p.test(m.callbackName));
}
