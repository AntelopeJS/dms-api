import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {{ folder: string, status: number | null, headers: Record<string, string>, bytes: Buffer, text: string, json: unknown }} Raw
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** Routes the verification playground registers in the project's scope: 17 under /fx, the member route and the five node routes. */
export const FIXTURE_ROUTES = 23;

/** The console's HTTP API, which the dashboard calls. */
export const MONITOR = "/api/monitoring";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is number} Whether it is a number
 */
export function isNumber(value) {
  return typeof value === "number";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is boolean} Whether it is a boolean
 */
export function isBoolean(value) {
  return typeof value === "boolean";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is (...args: never[]) => unknown} Whether it is a function
 */
export function isFunction(value) {
  return typeof value === "function";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {number | undefined} The field when it is a number
 */
export function num(value, ...path) {
  const found = pick(value, ...path);
  return isNumber(found) ? found : undefined;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {boolean | undefined} The field when it is a boolean
 */
export function flag(value, ...path) {
  const found = pick(value, ...path);
  return isBoolean(found) ? found : undefined;
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string[]} The `name` of each object of the array field
 */
export function names(value, ...path) {
  return list(value, ...path).map((row) => text(row, "name"));
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * A check that two JSON values are equal, with both in the detail.
 *
 * @param {string} name What is compared
 * @param {unknown} actual What was observed
 * @param {unknown} expected What the docs say
 * @returns {Check} The check
 */
export function same(name, actual, expected) {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * @param {string} body A response body
 * @returns {unknown} Its JSON value, or undefined when it is not JSON
 */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Calls the console's API as an account.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} path The path under /api/monitoring, with its query
 * @param {{ as?: string, method?: string, body?: unknown }} [options] The account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function mon(ctx, label, path, options = {}) {
  return ctx.api(label, { method: options.method ?? "GET", path: `${MONITOR}${path}`, body: options.body, as: options.as });
}

/**
 * The session token of an account, after one authenticated call signed it in.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The account
 * @returns {Promise<string | undefined>} The token
 */
export async function tokenOf(ctx, account) {
  if (!ctx.state.tokens?.[account]) await ctx.api(`sign ${account} in`, { method: "GET", path: `${MONITOR}/settings/summary`, as: account });
  return ctx.state.tokens?.[account];
}

/**
 * Sends the project's own routes (`/fx/*`) a batch of calls, one after the other, and keeps one step with the statuses.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the batch is
 * @param {{ path: string, count: number, method?: string, headers?: Record<string, string>, body?: string }[]} batches What to send
 * @returns {Promise<Record<string, number>>} How many calls answered each status
 */
export async function traffic(ctx, label, batches) {
  const folder = ctx.step(`traffic ${label}`);
  /** @type {Record<string, number>} */
  const statuses = {};
  for (const batch of batches) {
    for (let index = 0; index < batch.count; index += 1) {
      const response = await fetch(`${ctx.state.apiUrl}${batch.path}`, { method: batch.method ?? "GET", headers: batch.headers, body: batch.body });
      await response.arrayBuffer();
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    }
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "traffic.json"), `${JSON.stringify({ batches, statuses }, null, 2)}\n`);
  ctx.record(folder, [check("every call answered", Object.keys(statuses).every((status) => status !== "0"), statuses)]);
  return statuses;
}

/**
 * Waits until a read of the console satisfies `accept` (the capture writes behind the response).
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What is awaited
 * @param {string} path The path under /api/monitoring
 * @param {(body: unknown) => boolean} accept Whether the answer is the awaited one
 * @returns {Promise<Answer>} The last answer
 */
export async function settled(ctx, label, path, accept) {
  const deadline = Date.now() + 15_000;
  let answer = await mon(ctx, label, path);
  while (!accept(answer.body) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    answer = await mon(ctx, `${label} again`, path);
  }
  return answer;
}

/**
 * A request to any URL with its response headers and bytes kept in the evidence, redirects not followed. Any method
 * is sent as given, HEAD and OPTIONS included.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the request does
 * @param {{ url?: string, path?: string, origin?: "api" | "web", method?: string, headers?: Record<string, string>, as?: string, body?: Buffer | string }} request What to send; `as` adds the account's session token
 * @returns {Promise<Raw>} The answer
 */
export async function raw(ctx, label, request) {
  const folder = ctx.step(label);
  const origin = request.origin === "web" ? ctx.state.webUrl : ctx.state.apiUrl;
  const url = request.url ?? `${origin}${request.path ?? "/"}`;
  const method = request.method ?? "GET";
  /** @type {Record<string, string>} */
  const headers = { ...request.headers };
  if (request.as) headers.authorization = `Bearer ${(await tokenOf(ctx, request.as)) ?? ""}`;
  const shown = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /auth|cookie/i.test(name) ? "<session>" : value]));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "request.json"), `${JSON.stringify({ method, url, headers: shown, bodyBytes: request.body === undefined ? 0 : Buffer.byteLength(request.body) }, null, 2)}\n`);
  const response = await fetch(url, { method, headers, redirect: "manual", body: request.body });
  const bytes = Buffer.from(await response.arrayBuffer());
  /** @type {Record<string, string>} */
  const received = {};
  for (const [name, value] of response.headers) received[name] = value;
  const body = bytes.toString("utf8");
  writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status, headers: received, bytes: bytes.byteLength, sha256: sha256(bytes), body: body.slice(0, 4000) }, null, 2)}\n`);
  return { folder, status: response.status, headers: received, bytes, text: body, json: parseJson(body) };
}

/**
 * Records checks against the evidence folder `raw` made.
 *
 * @param {Ctx} ctx The journey
 * @param {Raw} answer The answer
 * @param {Check[]} checks The checks
 * @returns {boolean} Whether they all passed
 */
export function recordRaw(ctx, answer, checks) {
  return ctx.record(answer.folder, checks);
}

/**
 * @param {Uint8Array} bytes Some bytes
 * @returns {string} Their SHA-256, hex
 */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Saves some of the console's settings through the settings form's route, as the owner.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What changes
 * @param {Record<string, unknown>} values The fields to write; `null` returns a field to its module default
 * @param {string} [as] The account
 * @returns {Promise<Answer>} The answer
 */
export function saveSettings(ctx, label, values, as) {
  return mon(ctx, `settings: ${label}`, "/settings", { method: "POST", body: values, as });
}

/**
 * Sends one call to the project's routes with the headers, query and body given, and reads the request log it made.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call is
 * @param {{ method?: string, path: string, headers?: Record<string, string>, body?: string }} request What to send
 * @returns {Promise<{ status: number, log: Row }>} The status answered and the captured request in full
 */
export async function sendAndRead(ctx, label, request) {
  const sent = await raw(ctx, label, request);
  const marker = `${request.method ?? "GET"} ${request.path.split("?")[0]}`;
  const deadline = Date.now() + 15_000;
  /** @type {Row} */
  let found = {};
  while (Date.now() < deadline) {
    const listed = await mon(ctx, `${label}: find it`, "/logs?limit=50");
    const row = list(listed.body, "results").find((entry) => entry.requestId === request.headers?.["x-request-id"] || (text(entry, "path") === request.path.split("?")[0] && `${text(entry, "method")} ${text(entry, "path")}` === marker));
    if (row) {
      const detail = await mon(ctx, `${label}: open it`, `/logs/${text(row, "_id")}`);
      found = isRow(detail.body) ? detail.body : {};
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { status: sent.status ?? 0, log: found };
}

/**
 * A check that a radio, switch or toggle button is on (or off), once it shows.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name?: string | RegExp, exact?: boolean }} target The control
 * @param {boolean} [expected] Whether it must be on
 * @returns {Promise<Check>} The check
 */
export async function isOn(tab, target, expected = true) {
  const element = tab.locator(target).first();
  await element.waitFor({ state: "visible", timeout: 15_000 }).then(() => undefined, () => undefined);
  const deadline = Date.now() + 8_000;
  let on = !expected;
  while (Date.now() < deadline && on !== expected) {
    on = await element
      .evaluate((node) => (node instanceof HTMLInputElement && node.checked) || ["aria-checked", "aria-pressed", "aria-selected"].some((name) => node.getAttribute(name) === "true") || node.getAttribute("data-state") === "on" || node.getAttribute("data-state") === "checked", undefined)
      .then((value) => value === true, () => false);
    if (on !== expected) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return check(`${target.role} "${String(target.name)}" is ${expected ? "on" : "off"}`, on === expected, tab.page.url());
}

/**
 * Restarts the backend with the module configured, runs `body`, then restarts it again with the module's own defaults.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, unknown>} config The module options (`VERIFY_API_CONFIG`)
 * @param {() => Promise<void>} body What to do under that configuration
 * @returns {Promise<void>}
 */
export async function withConfig(ctx, config, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, VERIFY_API_CONFIG: JSON.stringify(config) };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Creates a member whose role holds exactly `permissions`, signs them up, and lets the journey act as them.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name
 * @param {string[]} permissions The permission ids of the role
 * @returns {Promise<void>}
 */
export async function member(ctx, name, permissions) {
  const invite = await ctx.api(`invite ${name}`, { method: "POST", path: "/verify-api/member", body: { name, permissions }, as: "anon" });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, { method: "POST", path: "/api/auth/signup", body: { name, email, password, lang: "en", token: text(invite.body, "token") }, as: "anon" });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
}

/**
 * Opens a dashboard path and waits for the page to hydrate: a click that lands before it does nothing.
 *
 * @param {Tab} tab The tab
 * @param {string} path The path
 * @returns {Promise<void>}
 */
export async function openPage(tab, path) {
  await tab.goto(path);
  await tab.page.waitForLoadState("load");
  await tab.page.waitForTimeout(2500);
}

/**
 * Restarts the backend with extra environment variables, runs `body`, then restarts it with the previous ones.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables
 * @param {() => Promise<void>} body What to do under them
 * @returns {Promise<void>}
 */
export async function withEnv(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Runs an automation action the module registered with the stand-in provider.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The action's id
 * @param {unknown} input Its input
 * @returns {Promise<Answer>} The action's output
 */
export function runAction(ctx, id, input) {
  return ctx.api(`run ${id} ${JSON.stringify(input).slice(0, 60)}`, { method: "POST", path: `/dms/verify-api/nodes/action/${id}`, body: input, as: "anon" });
}
