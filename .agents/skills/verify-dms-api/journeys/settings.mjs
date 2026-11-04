import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { check, list, mon, pick, same, saveSettings, settled, text, traffic, withConfig, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const DEFAULT_HEADERS = ["content-type", "content-length", "user-agent", "accept", "accept-encoding", "host", "referer", "origin"];

/**
 * Saves one field and reads the status back.
 *
 * @param {Ctx} ctx The journey
 * @param {string} field The settings field
 * @param {unknown} value The value
 * @returns {Promise<number | null>} The HTTP status
 */
async function statusOf(ctx, field, value) {
  return (await saveSettings(ctx, `${field} = ${JSON.stringify(value).slice(0, 40)}`, { [field]: value })).status;
}

/**
 * Restarts the backend with the module configured, and reports whether it came back.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, unknown>} config The module options
 * @returns {Promise<{ started: boolean, log: string }>} Whether it started, and the backend log
 */
async function startWith(ctx, config) {
  const previous = { ...ctx.state.extraEnv };
  const file = join(ctx.state.logs, "backend.log");
  const before = existsSync(file) ? statSync(file).size : 0;
  ctx.state.extraEnv = { ...previous, VERIFY_API_CONFIG: JSON.stringify(config) };
  let started = true;
  try {
    await ctx.restartBackend();
  } catch {
    started = false;
  }
  const log = readFileSync(file).subarray(before).toString("utf8");
  ctx.state.extraEnv = previous;
  return { started, log };
}

export const journeys = guarded([
  {
    id: "the-form-shows-the-documented-defaults",
    title: "a fresh console holds the documented defaults: own routes, 30 days of logs, 90 days of statistics, a 64 KB body cap, the eight headers, a 1000 ms slow threshold, the fixed 5% and 20% rates and the 23 redacted words",
    entryPoint: "GET /api/monitoring/settings and /modules/api/settings",
    async run(/** @type {Ctx} */ ctx) {
      const settings = await mon(ctx, "the form's values", "/settings");
      const summary = await mon(ctx, "the summary", "/settings/summary");
      await ctx.verify("the values", [
        same("scope", pick(settings.body, "scope"), "own"),
        same("log retention", pick(settings.body, "requestLogRetentionDays"), 30),
        same("statistics retention", pick(settings.body, "statisticsLifetimeDays"), 90),
        same("body cap", pick(settings.body, "requestLogMaxBodyKb"), 64),
        same("headers", pick(settings.body, "requestLogCaptureHeaders"), DEFAULT_HEADERS),
        same("slow threshold", pick(settings.body, "requestSlownessThresholdMs"), 1000),
        same("error rate warning", pick(settings.body, "errorRateWarning"), 0.05),
        same("down rate", pick(settings.body, "downErrorRate"), 0.2),
        same("the summary carries the scope", pick(summary.body, "scope"), "own"),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/settings");
      await ctx.verify("the page", [
        tab.shows(/Own routes\s+Your project's code only/),
        tab.shows(/Module routes\s+Installed modules only/),
        tab.shows(/All routes\s+No filtering/),
        tab.shows(/1 to 366 days\./),
        tab.shows(/30 days\s+No 30D comparison with the period before/),
        tab.shows(/90 days\s+Default · keeps the 30D comparison/),
        tab.shows(/0 to 10,240 KB\. 0 turns body capture off\./),
        tab.shows(/50 to 600,000 ms, in steps of 50\./),
        tab.shows(/Error rate warning[\s\S]*5%\s+Fixed in this version/),
        tab.shows(/Down threshold[\s\S]*20%\s+Fixed in this version/),
        tab.shows(/Not editable/),
      ]);
    },
  },
  {
    id: "every-bound-of-the-form-is-enforced-on-its-edge",
    title: "the retentions, body cap, slow threshold and header list accept their documented edge values and refuse the value just outside",
    entryPoint: "POST /api/monitoring/settings",
    async run(/** @type {Ctx} */ ctx) {
      const cases = [
        ["requestLogRetentionDays", [[0, 400], [1, 200], [366, 200], [367, 400], [1.5, 400]]],
        ["statisticsLifetimeDays", [[45, 400], [30, 200], [60, 200], [90, 200], [120, 400]]],
        ["requestLogMaxBodyKb", [[-1, 400], [0, 200], [10240, 200], [10241, 400]]],
        ["requestSlownessThresholdMs", [[49, 400], [50, 200], [75, 400], [100, 200], [600000, 200], [600050, 400]]],
        ["scope", [["own", 200], ["modules", 200], ["all", 200], ["everything", 400]]],
      ];
      for (const [field, expectations] of cases) {
        const seen = [];
        for (const [value, expected] of expectations) seen.push([value, await statusOf(ctx, String(field), value), expected]);
        await ctx.verify(String(field), seen.map(([value, got, expected]) => same(`${String(field)} = ${String(value)}`, got, expected)));
      }
      const fifty = Array.from({ length: 50 }, (_, index) => `x-h${index}`);
      await ctx.verify("the header list", [
        same("50 headers are accepted", await statusOf(ctx, "requestLogCaptureHeaders", fifty), 200),
        same("51 headers are refused", await statusOf(ctx, "requestLogCaptureHeaders", [...fifty, "x-one-more"]), 400),
      ]);
      const secretHeaders = ["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization", "X-Authorization", "x-antelopejs-api-source"];
      const refusals = [];
      for (const header of secretHeaders) refusals.push([header, await statusOf(ctx, "requestLogCaptureHeaders", [header])]);
      await ctx.verify("secret-looking headers", refusals.map(([header, status]) => same(`${String(header)} is refused`, status, 400)));
      const kept = [];
      for (const header of ["x-request-trace", "accept-language", "if-none-match"]) kept.push([header, await statusOf(ctx, "requestLogCaptureHeaders", [header])]);
      await ctx.verify("ordinary headers", kept.map(([header, status]) => same(`${String(header)} is accepted`, status, 200)));
    },
  },
  {
    id: "use-default-returns-a-field-to-the-module-option",
    title: "a saved value overrides the module option without a restart; null (Use default) removes the override and the field follows the option again; the override survives a restart",
    entryPoint: "POST /api/monitoring/settings with null",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { requestSlownessThreshold: 500, requestLogMaxBodySize: 2048 }, async () => {
        const base = await mon(ctx, "module options", "/settings");
        await saveSettings(ctx, "override the slow threshold", { requestSlownessThresholdMs: 250 });
        const overridden = await mon(ctx, "after the override", "/settings");
        await ctx.restartBackend();
        const restarted = await mon(ctx, "after a restart", "/settings");
        await saveSettings(ctx, "use default", { requestSlownessThresholdMs: null });
        const back = await mon(ctx, "after Use default", "/settings");
        await ctx.verify("overrides", [
          same("the module options are read: slow", pick(base.body, "requestSlownessThresholdMs"), 500),
          same("the module options are read: body cap in KB", pick(base.body, "requestLogMaxBodyKb"), 2),
          same("the override wins at once", pick(overridden.body, "requestSlownessThresholdMs"), 250),
          same("the override survives a restart", pick(restarted.body, "requestSlownessThresholdMs"), 250),
          same("Use default follows the module option again", pick(back.body, "requestSlownessThresholdMs"), 500),
          same("the other field was never overridden", pick(back.body, "requestLogMaxBodyKb"), 2),
        ]);
      });
    },
  },
  {
    id: "the-module-refuses-to-start-with-a-value-the-form-would-refuse",
    title: "a module option the settings form would refuse (statistics kept 45 days, a slow threshold off its step, a body cap or log retention out of bounds, a secret header) stops the module at start with the reasons; valid options start it",
    entryPoint: "the dms-api entry of antelope.config.ts",
    async run(/** @type {Ctx} */ ctx) {
      const DAY = 86_400_000;
      const refused = [
        { name: "statisticsLifetime", config: { statisticsLifetime: 45 * DAY } },
        { name: "requestSlownessThreshold off its step", config: { requestSlownessThreshold: 75 } },
        { name: "requestLogMaxBodySize above 10 MB", config: { requestLogMaxBodySize: 10_241 * 1024 } },
        { name: "requestLogRetention of 367 days", config: { requestLogRetention: 367 * DAY } },
        { name: "a secret header", config: { requestLogCaptureHeaders: ["authorization"] } },
      ];
      const results = [];
      for (const { name, config } of refused) {
        const outcome = await startWith(ctx, config);
        results.push({ name, started: outcome.started, said: /\[dms-api\] invalid configuration/.test(outcome.log) });
        await ctx.restartBackend();
      }
      await ctx.verify("refused options", results.map((entry) => check(`${entry.name}: the module stops and says so`, !entry.started && entry.said, entry)));
      const accepted = await startWith(ctx, { statisticsLifetime: 60 * DAY, requestLogRetention: 14 * DAY, requestSlownessThreshold: 500, requestLogMaxBodySize: 0, requestLogCaptureHeaders: ["x-webhook-signature"] });
      await ctx.verify("valid options", [check("the module starts", accepted.started, accepted.started)]);
    },
  },
  {
    id: "the-scope-decides-which-routes-and-requests-every-page-watches",
    title: "Own routes lists the project's routes, Module routes the installed modules' routes, All routes both; the Request logs and the Routes list follow, and a scope change applies at once",
    entryPoint: "POST /api/monitoring/settings scope",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "a project route", [{ path: "/fx/ok", count: 2 }]);
      await ctx.api("a module route", { method: "GET", path: "/api/onboarding/informations", as: "anon" });
      const readScope = async (/** @type {string} */ scope) => {
        const saved = await saveSettings(ctx, `scope ${scope}`, { scope });
        const routes = await mon(ctx, `routes under ${scope}`, "/routes/list");
        const logs = await settled(ctx, `logs under ${scope}`, "/logs?limit=200", () => true);
        const paths = list(routes.body, "routes").map((row) => text(row, "path"));
        return { status: saved.status, projectRoutes: paths.filter((path) => path.startsWith("/fx/")).length, moduleRoutes: paths.filter((path) => !path.startsWith("/fx/")).length, logged: list(logs.body, "results").map((row) => text(row, "path")) };
      };
      const own = await readScope("own");
      const module = await readScope("modules");
      const all = await readScope("all");
      await ctx.verify("scopes", [
        same("own: every route is the project's (the fixture and its member route)", [own.projectRoutes + own.moduleRoutes, own.moduleRoutes], [16, 1]),
        check("own: only the project's request is logged", own.logged.every((path) => path === "/fx/ok") && own.logged.length === 2, own.logged),
        check("modules: no fixture route, the installed modules' routes", module.projectRoutes === 0 && module.moduleRoutes > 100, module.moduleRoutes),
        check("modules: no fixture request is logged", !module.logged.includes("/fx/ok"), module.logged),
        same("all: both", [all.projectRoutes + all.moduleRoutes, all.projectRoutes], [own.projectRoutes + own.moduleRoutes + module.moduleRoutes, 15]),
        check("all: the project's and the module's requests are logged", all.logged.includes("/fx/ok") && all.logged.includes("/api/onboarding/informations"), all.logged),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/overview");
      await ctx.verify("the scope chip", [tab.shows(new RegExp(`All routes · ${all.projectRoutes + all.moduleRoutes}`))]);
      await ctx.restartBackend();
      const kept = await mon(ctx, "after a restart", "/settings");
      await ctx.verify("the scope survives a restart", [same("scope", pick(kept.body, "scope"), "all")]);
    },
  },
  {
    id: "a-log-retention-of-no-day-is-refused-at-start",
    title: "a requestLogRetention of 0 is out of the 1 to 366 days the settings page accepts, so the module refuses to start with it",
    entryPoint: "the dms-api entry of antelope.config.ts",
    async run(/** @type {Ctx} */ ctx) {
      const outcome = await startWith(ctx, { requestLogRetention: 0 });
      const form = outcome.started ? await mon(ctx, "the form's retention", "/settings") : undefined;
      if (outcome.started) await ctx.restartBackend();
      await ctx.verify("a retention of 0", [
        check("the module stops and says so", !outcome.started && /\[dms-api\] invalid configuration/.test(outcome.log), { started: outcome.started, form: form?.body }),
      ]);
    },
  },
  {
    id: "retention-fields-have-no-use-default-but-the-others-do",
    title: "once overridden, the slow threshold and the body size show Use default beside their module default; the two retentions never do, since lowering a retention deletes data",
    entryPoint: "/modules/api/settings",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/settings");
      await ctx.verify("nothing overridden", [tab.visible({ role: "button", name: "Use default" }, { hidden: true, timeoutMs: 3000 })]);
      await saveSettings(ctx, "override four fields", { requestLogRetentionDays: 7, statisticsLifetimeDays: 30, requestSlownessThresholdMs: 250, requestLogMaxBodyKb: 8 });
      await openPage(tab, "/modules/api/settings");
      await ctx.verify("overridden", [
        tab.shows(/Module\s+default:\s*64/i),
        tab.shows(/Module\s+default:\s*1,000/i),
        tab.count({ role: "button", name: "Use default" }, 2),
      ]);
    },
  },
]);
