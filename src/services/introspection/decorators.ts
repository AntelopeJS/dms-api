import { readFileSync } from "node:fs";
import { isObject } from "@/guards";

/**
 * Decorators read back from the compiled source of a controller.
 *
 * Across module boundaries the runtime hands handlers and parameter providers
 * out as proxies, whose source reads `function () { [native code] }`: the DMS
 * guards (@AuthUserWithPermission…) and the stock @Parameter cannot be probed
 * from their provider. The controller class itself is passed as is, and so is
 * the file that defines it. TypeScript compiles decorators to `__decorate`
 * calls next to the class, which name each decorator and keep its literal
 * arguments and the declared parameter types:
 *
 *   __decorate([
 *     (0, interface_api_1.Get)("detail"),
 *     __param(0, (0, guards_1.AuthUserWithPermission)(explorer.targetChild("header"))),
 *     __param(1, (0, interface_api_1.Parameter)("route", "query")),
 *     __metadata("design:paramtypes", [Function, String]),
 *   ], RoutesController.prototype, "getDetail", null);
 *
 * Code built another way (a bundle that renames the helpers, ES decorators, a
 * controller its module does not export) yields nothing, and the provider
 * probes stay the only source.
 */

export interface DecoratedParameter {
  index: number;
  /** Decorator name, e.g. `Parameter` or `AuthUserWithPermission`. */
  decorator: string;
  /** Its arguments: the string literals, null for anything else. */
  args: Array<string | null>;
  /** Declared type from `design:paramtypes`, e.g. `String`; null if absent. */
  type: string | null;
}

export interface ControllerDecorators {
  /** Decorators of the class itself. */
  classDecorators: string[];
  /** Decorators of the class members, computed for every handler. */
  propertyDecorators: Record<string, string[]>;
  /** Parameter decorators of each method. */
  methods: Record<string, DecoratedParameter[]>;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const BLOCK_END =
  /^\s*,\s*([A-Za-z_$][\w$]*)(?:\.prototype\s*,\s*"([^"]+)"\s*,\s*(null|void 0))?\s*\)/;
const OPENERS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** Index just past the string literal that starts at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote) {
    index += text[index] === "\\" ? 2 : 1;
  }
  return index + 1;
}

/** Index of the bracket closing the one at `start`, -1 if unbalanced. */
function closingOf(text: string, start: number): number {
  const stack: string[] = [];
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(text, index);
      continue;
    }
    const closer = OPENERS.get(char);
    if (closer) stack.push(closer);
    else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return index;
    }
    index += 1;
  }
  return -1;
}

/** `text` split on its top-level commas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(text, index);
      continue;
    }
    if (OPENERS.has(char)) depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(from, index).trim());
      from = index + 1;
    }
    index += 1;
  }
  const last = text.slice(from).trim();
  if (last) parts.push(last);
  return parts;
}

function literal(expression: string): string | null {
  const match = expression.match(/^(["'])((?:\\.|(?!\1).)*)\1$/);
  return match ? match[2] : null;
}

/**
 * A decorator expression's name and arguments: `(0, mod_1.Parameter)("id")`,
 * `mod_1.Parameter("id")`, `Parameter("id")` or a bare `JSONBody`. The
 * argument list is the group that closes on the last character; one opening
 * the expression is the `(0, mod_1.Name)` sequence, not a call.
 */
function decoratorCall(
  expression: string,
): { name: string; args: string[] } | undefined {
  let callee = expression.trim();
  let args: string[] = [];
  let start = callee.indexOf("(");
  while (start >= 0 && closingOf(callee, start) !== callee.length - 1) {
    start = callee.indexOf("(", start + 1);
  }
  if (start > 0) {
    args = splitTopLevel(callee.slice(start + 1, -1));
    callee = callee.slice(0, start).trim();
  }
  const sequence = callee.match(/^\(\s*0\s*,\s*([^)]+)\)$/);
  if (sequence) callee = sequence[1].trim();
  const name = callee.split(".").pop() ?? "";
  return IDENTIFIER.test(name) ? { name, args } : undefined;
}

function paramTypes(entries: string[]): string[] {
  for (const entry of entries) {
    const call = decoratorCall(entry);
    if (
      call?.name !== "__metadata" ||
      literal(call.args[0] ?? "") !== "design:paramtypes"
    )
      continue;
    const list = call.args[1] ?? "";
    return list.startsWith("[") ? splitTopLevel(list.slice(1, -1)) : [];
  }
  return [];
}

function decoratedParameters(entries: string[]): DecoratedParameter[] {
  const types = paramTypes(entries);
  const parameters: DecoratedParameter[] = [];
  for (const entry of entries) {
    const call = decoratorCall(entry);
    if (call?.name !== "__param") continue;
    const index = Number.parseInt(call.args[0] ?? "", 10);
    const decorator = decoratorCall(call.args[1] ?? "");
    if (Number.isNaN(index) || !decorator) continue;
    parameters.push({
      index,
      decorator: decorator.name,
      args: decorator.args.map(literal),
      type: types[index] ?? null,
    });
  }
  return parameters.sort((a, b) => a.index - b.index);
}

function decoratorNames(entries: string[]): string[] {
  return entries
    .map((entry) => decoratorCall(entry)?.name)
    .filter(
      (name): name is string =>
        !!name && name !== "__param" && name !== "__metadata",
    );
}

/** The decorators the compiled `source` applies to the class `className`. */
export function parseControllerDecorators(
  source: string,
  className: string,
): ControllerDecorators {
  const found: ControllerDecorators = {
    classDecorators: [],
    propertyDecorators: {},
    methods: {},
  };
  const marker = "__decorate([";
  let at = source.indexOf(marker);
  while (at >= 0) {
    const open = at + marker.length - 1;
    const close = closingOf(source, open);
    if (close < 0) break;
    const end = source.slice(close + 1).match(BLOCK_END);
    if (end && end[1] === className) {
      const entries = splitTopLevel(source.slice(open + 1, close));
      const [, , key, kind] = end;
      if (key === undefined)
        found.classDecorators.push(...decoratorNames(entries));
      else if (kind === "null")
        found.methods[key] = decoratedParameters(entries);
      else found.propertyDecorators[key] = decoratorNames(entries);
    }
    at = source.indexOf(marker, close);
  }
  return found;
}

const parsed = new WeakMap<object, ControllerDecorators | null>();

function exportsOf(exported: unknown): unknown[] {
  if (typeof exported === "function") return [exported];
  if (!isObject(exported)) return [];
  try {
    return Object.values(exported);
  } catch {
    return [];
  }
}

/**
 * The file of a loaded module that exports `ctor` and defines it. A module
 * without a readable file (built in, virtual) is not ours.
 */
function definingSource(ctor: { name: string }): string | undefined {
  const cache = typeof require === "undefined" ? undefined : require.cache;
  const definition = new RegExp(`\\bclass ${ctor.name}\\b`);
  for (const loaded of Object.values(cache ?? {})) {
    if (!loaded || !exportsOf(loaded.exports).includes(ctor)) continue;
    try {
      const source = readFileSync(loaded.filename, "utf8");
      if (definition.test(source)) return source;
    } catch {}
  }
  return undefined;
}

/**
 * The decorators of the controller whose prototype is `proto`, read once per
 * class. Undefined when the class cannot be traced back to its source.
 */
export function controllerDecorators(
  proto: unknown,
): ControllerDecorators | undefined {
  const ctor = (proto as { constructor?: unknown } | undefined)?.constructor;
  if (typeof ctor !== "function" || !IDENTIFIER.test(ctor.name))
    return undefined;
  if (!parsed.has(ctor)) {
    const source = definingSource(ctor);
    parsed.set(
      ctor,
      source ? parseControllerDecorators(source, ctor.name) : null,
    );
  }
  return parsed.get(ctor) ?? undefined;
}

const AUTH_DECORATOR = /^Auth(?:[A-Z]\w*)?$|^Authenticat/;

/** Whether a decorator name is an authentication guard (AuthUser, AuthTenantOwner…). */
export function isAuthDecorator(name: string): boolean {
  return AUTH_DECORATOR.test(name);
}
