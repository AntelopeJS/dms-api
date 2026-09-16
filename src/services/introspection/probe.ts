import type { ComputedParameter } from "@antelopejs/interface-api";

/**
 * Source-text inspection for ComputedParameter providers.
 *
 * AntelopeJS exposes parameter and property providers as opaque closures
 * — there is no runtime metadata for "is this @Body, @Query, @Param".
 * This module reads `provider.toString()` and matches access patterns in
 * the compiled source. Only some stock decorators are recognisable this
 * way (@JSONBody, @RawBody, @Context, @Result, @Connection): the stock
 * @Parameter/@MultiParameter providers (param/query/header) capture the
 * parameter name in a closure variable, which the literal-name patterns
 * below cannot match, so they come out as `unknown`. Unknown providers
 * fall through; the raw source is returned so the UI can render it
 * verbatim.
 *
 * This is the single point that will be swapped when the AntelopeJS
 * runtime gains a proper introspection facility — the public shape
 * of {@link probeProvider} should remain stable.
 */

export type ParameterSource =
  | "body"
  | "query"
  | "param"
  | "header"
  | "context"
  | "result"
  | "raw"
  | "stream"
  | "connection"
  | "unknown";

export type InferredType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "buffer"
  | "stream"
  | "unknown";

export interface ProbedParameter {
  source: ParameterSource;
  name: string | null;
  multi: boolean;
  inferredType: InferredType;
  rawProviderSource?: string;
  hint?: string;
}

const PROVIDER_PATTERNS: Array<{
  source: ParameterSource;
  multi?: boolean;
  match: RegExp;
  nameGroup?: number;
}> = [
  // Route-param access with a literal name: routeParameters["x"] /
  // routeParameters.x (hand-written providers; not the stock @Parameter)
  {
    source: "param",
    match:
      /routeParameters\s*(?:\[\s*['"]([^'"]+)['"]\s*\]|\.([A-Za-z_$][\w$]*))/,
    nameGroup: 1,
  },
  // Multi query access with a literal name: searchParams.getAll("x")
  // (hand-written providers; not the stock @MultiParameter)
  {
    source: "query",
    multi: true,
    match: /searchParams\s*\.\s*getAll\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    nameGroup: 1,
  },
  // Query access with a literal name: searchParams.get("x")
  // (hand-written providers; not the stock @Parameter)
  {
    source: "query",
    match: /searchParams\s*\.\s*get\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    nameGroup: 1,
  },
  // Less common: searchParams indexed access
  {
    source: "query",
    match: /searchParams\s*\[\s*['"]([^'"]+)['"]\s*\]/,
    nameGroup: 1,
  },
  // Header access with a literal name: headers["x"] / headers.x
  // (hand-written providers; not the stock @Parameter)
  {
    source: "header",
    match: /headers\s*(?:\[\s*['"]([^'"]+)['"]\s*\]|\.([A-Za-z_$][\w$]*))/,
    nameGroup: 1,
  },
  // @JSONBody() -> JSON.parse over the body
  {
    source: "body",
    match: /JSON\s*\.\s*parse\b/,
  },
  // @RawBody -> returns context.body directly (Buffer)
  {
    source: "raw",
    match: /\bcontext\b\s*\.\s*body\b/,
  },
  // Hand-written stream providers (rawResponse / writeHead / WriteStream).
  // The stock @WriteStream provider compiles to
  // `context.response.getWriteStream(type)`, which this pattern does not
  // match (no word boundary inside `getWriteStream`); it is classified by
  // the `result` pattern below instead.
  {
    source: "stream",
    match: /\b(?:rawResponse|writeHead|WriteStream)\b/,
  },
  // @Connection -> websocket connection
  {
    source: "connection",
    match: /\bconnection\b/,
  },
  // @Result -> the HTTPResult / response object
  {
    source: "result",
    match: /\bcontext\b\s*\.\s*response\b/,
  },
  // @Context -> the bare context object
  {
    source: "context",
    match:
      /^\s*(?:function[^(]*)?\s*\(([A-Za-z_$][\w$]*)\)\s*(?:=>\s*\1|\{\s*return\s+\1\s*;?\s*\})/,
  },
];

/**
 * Probe a ComputedParameter to determine its source kind and (where possible) name.
 *
 * Returns `{source: "unknown", ...}` for providers that don't match any known
 * pattern; the raw source text is included so the UI can show "we don't
 * recognise this one — here's what it does".
 */
export function probeProvider(
  param: ComputedParameter | null,
): ProbedParameter {
  if (!param || !param.provider) {
    return {
      source: "unknown",
      name: null,
      multi: false,
      inferredType: "unknown",
    };
  }

  const source = providerSource(param.provider);

  for (const pattern of PROVIDER_PATTERNS) {
    const m = source.match(pattern.match);
    if (!m) continue;
    const name =
      pattern.nameGroup !== undefined
        ? (m[pattern.nameGroup] ?? m[pattern.nameGroup + 1] ?? null)
        : null;
    return {
      source: pattern.source,
      name,
      multi: pattern.multi ?? false,
      inferredType: inferType(pattern.source, source),
    };
  }

  return {
    source: "unknown",
    name: null,
    multi: false,
    inferredType: "unknown",
    rawProviderSource: source,
    hint: extractHint(source),
  };
}

function providerSource(fn: unknown): string {
  try {
    return Function.prototype.toString.call(fn);
  } catch {
    return "";
  }
}

/**
 * Best-effort type inference from the provider body.
 *
 * For the common case of `@Parameter("limit", "query")` the value is plumbed
 * straight through, so we default to `string`. When the closure obviously
 * coerces or parses the value (`Number(...)`, `JSON.parse(...)`), we promote
 * the inferred type to match. The intent is "good enough for the UI" — false
 * positives are fine because the user can always check the raw provider.
 */
function inferType(
  source: ParameterSource,
  providerText: string,
): InferredType {
  if (source === "raw") return "buffer";
  if (source === "stream") return "stream";
  if (source === "connection") return "object";
  if (source === "context" || source === "result") return "object";

  if (/JSON\s*\.\s*parse\b/.test(providerText)) return "object";

  if (
    /\bNumber\s*\(/.test(providerText) ||
    /\bparseInt\s*\(/.test(providerText) ||
    /\bparseFloat\s*\(/.test(providerText) ||
    /\+\s*[A-Za-z_$]/.test(providerText)
  ) {
    return "number";
  }

  if (
    /\bBoolean\s*\(/.test(providerText) ||
    /!!\s*[A-Za-z_$]/.test(providerText) ||
    /===\s*['"]true['"]/.test(providerText)
  ) {
    return "boolean";
  }

  if (source === "body") return "object";

  if (source === "param" || source === "query" || source === "header") {
    return "string";
  }

  return "unknown";
}

/**
 * Pick the first meaningful identifier referenced inside the provider body
 * — typically `context.something`. Used to give an unknown provider a chip
 * the user can scan instead of a wall of source.
 */
function extractHint(providerText: string): string | undefined {
  const contextMatch = providerText.match(
    /\bcontext\s*\.\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/,
  );
  if (contextMatch) {
    return contextMatch[1].replace(/\s+/g, "");
  }
  const bodyMatch = providerText.match(
    /=>\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/,
  );
  if (bodyMatch) {
    return bodyMatch[1].replace(/\s+/g, "");
  }
  return undefined;
}

export interface ProbedProperty {
  decorator: string;
  rawProviderSource?: string;
  hint?: string;
}

/**
 * Try to identify the decorator that produced a class-property's
 * ComputedParameter. Returns the bare provider source for fall-through.
 */
export function probeProperty(param: ComputedParameter): ProbedProperty {
  if (!param.provider) {
    return { decorator: "unknown" };
  }
  const source = providerSource(param.provider);

  // @Model(...) from interface-database-decorators reaches into GetModel
  if (/\bGetModel\b/.test(source)) {
    return { decorator: "Model" };
  }
  // Generic "Injected" / DI-style markers — extend over time
  if (/\bgetInstance\b|\bcontainer\b/.test(source)) {
    return { decorator: "Injected" };
  }

  return {
    decorator: "unknown",
    rawProviderSource: source,
    hint: extractHint(source),
  };
}
