import { guarded } from "../guard.mjs";
import { FIXTURE_ROUTES, check, list, mon, pick, same, saveSettings, settled, text, traffic, withConfig, openPage } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const DEFAULT_HEADERS = ["content-type", "content-length", "user-agent", "accept", "accept-encoding", "host", "referer", "origin"];

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
        same("own: every route is the project's (the fixture, its member route and its node routes)", [own.projectRoutes + own.moduleRoutes, own.moduleRoutes], [FIXTURE_ROUTES, 6]),
        check("own: only the project's request is logged", own.logged.every((path) => path === "/fx/ok") && own.logged.length === 2, own.logged),
        check("modules: no fixture route, the installed modules' routes", module.projectRoutes === 0 && module.moduleRoutes > 100, module.moduleRoutes),
        check("modules: no fixture request is logged", !module.logged.includes("/fx/ok"), module.logged),
        same("all: both", [all.projectRoutes + all.moduleRoutes, all.projectRoutes], [own.projectRoutes + own.moduleRoutes + module.moduleRoutes, 17]),
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
  {
    id: "the-use-default-button-removes-an-override-on-the-page",
    title: "Use default on the settings page puts the module's own value in the field, says what it was, and saving removes the override: the console reads the module option, and follows it when the option changes",
    entryPoint: "/modules/api/settings",
    async run(/** @type {Ctx} */ ctx) {
      const SLOW = { role: "spinbutton", name: "Slow request (ms)" };
      const USE_DEFAULT = { role: "button", name: "Use default" };
      const slowOf = async (/** @type {string} */ label) => pick((await mon(ctx, label, "/settings")).body, "requestSlownessThresholdMs");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await withConfig(ctx, { requestSlownessThreshold: 500 }, async () => {
        await saveSettings(ctx, "override the slow threshold", { requestSlownessThresholdMs: 250 });
        await openPage(tab, "/modules/api/settings");
        await ctx.verify("the override", [
          same("the field holds it", await tab.value(SLOW), "250"),
          tab.shows(/Module\s+default:\s*500/i),
          tab.count(USE_DEFAULT, 1),
        ]);
        await tab.click(USE_DEFAULT);
        await ctx.verify("Use default", [
          same("the field holds the module's value", await tab.value(SLOW), "500"),
          tab.shows(/Changed\s*·\s*was\s*250/),
          tab.visible({ role: "button", name: "Save changes" }),
          same("nothing is saved yet", await slowOf("the override is still stored"), 250),
        ]);
        await tab.click({ role: "button", name: "Save changes" });
        await ctx.verify("saved", [tab.visible({ role: "button", name: "Save changes" }, { hidden: true, timeoutMs: 8000 }), same("the console reads the module option", await slowOf("after the save"), 500)]);
        await openPage(tab, "/modules/api/settings");
        await ctx.verify("a reload", [same("the field holds the module's value", await tab.value(SLOW), "500"), tab.count(USE_DEFAULT, 0)]);
      });
      await withConfig(ctx, { requestSlownessThreshold: 700 }, async () => {
        await ctx.verify("the override is gone", [same("the console follows the module option again", await slowOf("under another module option"), 700)]);
        await openPage(tab, "/modules/api/settings");
        await ctx.verify("the page follows it", [same("the field holds it", await tab.value(SLOW), "700"), tab.count(USE_DEFAULT, 0)]);
      });
    },
  },
]);
