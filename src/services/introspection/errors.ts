/**
 * Best-effort error-code inference for route handlers.
 *
 * The runtime doesn't expose declared error responses, so we scan the
 * handler's source text for the conventional patterns used in this
 * codebase: `assert(cond, code, reason?)` from `@antelopejs/interface-api-util`
 * and direct `throw new HTTPResult(code, ...)` constructions. The result
 * is informative, not authoritative — refactors that hide the literal
 * status behind a constant will silently drop the inference.
 *
 * Replace this whole file when an `@ApiError(...)` decorator or a similar
 * declarative point lands; the public `probeHandlerErrors` shape can stay.
 */

export interface InferredErrorCode {
  status: number;
  reason: string | null;
  source: "assert" | "HTTPResult";
}

// `\)?\s*` between the symbol and the opening paren absorbs the
// `(0, mod_1.assert)(...)` shape TypeScript emits for named imports.
const ASSERT_PATTERN =
  /\bassert\)?\s*\(\s*[^,)]+,\s*(\d{3})(?:\s*,\s*(?:['"`])([^'"`]*)(?:['"`]))?/g;

const HTTP_RESULT_PATTERN =
  /\b(?:new\s+)?(?:[A-Za-z_$][\w$]*\.)?HTTPResult\)?\s*\(\s*(\d{3})(?:\s*,\s*(?:['"`])([^'"`]*)(?:['"`]))?/g;

export function probeHandlerErrors(handler: unknown): InferredErrorCode[] {
  const source = handlerSource(handler);
  if (!source) return [];

  const found = new Map<number, InferredErrorCode>();

  for (const match of source.matchAll(ASSERT_PATTERN)) {
    const status = Number.parseInt(match[1], 10);
    if (!isPlausibleErrorStatus(status)) continue;
    if (!found.has(status)) {
      found.set(status, {
        status,
        reason: match[2] ?? null,
        source: "assert",
      });
    }
  }

  for (const match of source.matchAll(HTTP_RESULT_PATTERN)) {
    const status = Number.parseInt(match[1], 10);
    if (!isPlausibleErrorStatus(status)) continue;
    if (!found.has(status)) {
      found.set(status, {
        status,
        reason: match[2] ?? null,
        source: "HTTPResult",
      });
    }
  }

  return [...found.values()].sort((a, b) => a.status - b.status);
}

function handlerSource(fn: unknown): string {
  if (typeof fn !== "function") return "";
  try {
    return Function.prototype.toString.call(fn);
  } catch {
    return "";
  }
}

function isPlausibleErrorStatus(status: number): boolean {
  return status >= 400 && status < 600;
}
