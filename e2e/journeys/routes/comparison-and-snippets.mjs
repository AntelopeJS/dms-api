import { seedLogs } from "../../seed.mjs";
import { list, mon, num, pick, same, saveSettings, settled, text, traffic, withEnv, openPage } from "../../api.mjs";
import { named } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

/** The routes journeys about comparison and snippets. */
export const comparisonAndSnippets = [
  {
    id: "a-route-from-an-installed-module-names-its-module",
    title: "under All routes a route registered by an installed module opens with its controller and the module that registered it where the project's routes read Project code, and the project's route still reads Project code",
    entryPoint: "/modules/api/routes?route=GET /api/onboarding/informations",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "watch all routes", { scope: "all" });
      const detailOf = await mon(ctx, "the module route", `/routes/detail?${named("GET /api/onboarding/informations")}`);
      const own = await mon(ctx, "the project route", `/routes/detail?${named("GET /fx/ok")}`);
      await ctx.verify("the API", [
        same("the module route is not the project's", [pick(detailOf.body, "own"), pick(own.body, "own")], [false, true]),
        same("the module that registered it", [text(detailOf.body, "module") !== "app", text(own.body, "module")], [true, "app"]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named("GET /api/onboarding/informations")}`);
      await ctx.verify("the header of the module route", [tab.shows(/PublicOnboardingController\.getInformations\s+Auth unknown\s+Module dms\s+First seen/), tab.shows(/Project code/, { not: true, timeoutMs: 2000 })]);
      await openPage(tab, `/modules/api/routes?${named("GET /fx/ok")}`);
      await ctx.verify("the header of the project route", [tab.shows(/FixtureController\.ok\s+Auth unknown\s+Project code/), tab.shows(/Module dms/, { not: true, timeoutMs: 2000 })]);
    },
  },
  {
    id: "the-route-statistics-compare-in-points-with-the-period-before",
    title: "with 1 client error in 10 calls the period before and 3 in 10 now, the route's requests read +0% vs 10, the error rate +20 pt vs 10% (points, not percent), and its top error reads +200% vs 1 the period before",
    entryPoint: "/modules/api/routes?route=GET /fx/ok&tab=statistics",
    async run(/** @type {Ctx} */ ctx) {
      await seedLogs(ctx, "9 good calls 30 hours ago", { minutesAgo: 1800, count: 9, uri: "/fx/ok" });
      await seedLogs(ctx, "1 client error 30 hours ago", { minutesAgo: 1800, count: 1, uri: "/fx/ok", statusCode: 404, message: "seeded gone" });
      await seedLogs(ctx, "7 good calls now", { minutesAgo: 20, count: 7, uri: "/fx/ok" });
      await seedLogs(ctx, "3 client errors now", { minutesAgo: 20, count: 3, uri: "/fx/ok", statusCode: 404, message: "seeded gone" });
      const ref = "GET /fx/ok";
      await settled(ctx, "the compared period", `/routes/statistics/summary?${named(ref)}&preset=last-24h&comparison=previous-period`, (body) => num(list(body, "items").find((item) => text(item, "id") === "requests"), "value") === 10);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named(ref)}&tab=statistics`);
      await ctx.verify("the figures", [
        tab.shows(/REQUESTS\s+10\s+\+0% vs\. 10 previous period/),
        tab.shows(/ERROR RATE\s+30%\s+3 × 4xx · 0 × 5xx · \+20 pt vs\. 10% previous period/),
        tab.shows(/404 · seeded gone\s+Client error · last [^\n]* · \+200% vs\. 1 previous period\s+3/),
      ]);
    },
  },
  {
    id: "the-documentation-writes-its-snippets-against-the-public-api-origin-and-hides-what-was-never-called",
    title: "with apiBaseUrl set to https://api.example.com the cURL and fetch snippets and the route detail use it; a route never called shows no responses, body or parameters section",
    entryPoint: "/modules/api/routes?route=GET /fx/ok&tab=documentation",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "one call", [{ path: "/fx/ok", count: 1 }]);
      await withEnv(ctx, { VERIFY_API_BASE_URL: "https://api.example.com" }, async () => {
        await settled(ctx, "the call is counted", `/routes/detail?${named("GET /fx/ok")}`, (body) => num(body, "contract", "total") === 1);
        const detail = await mon(ctx, "the detail", `/routes/detail?${named("GET /fx/ok")}`);
        const tab = await ctx.tab("admin");
        await tab.signIn("admin");
        await openPage(tab, `/modules/api/routes?${named("GET /fx/ok")}&tab=documentation`);
        await ctx.verify("the public origin", [
          same("the route detail", text(detail.body, "apiOrigin"), "https://api.example.com"),
          tab.shows(/curl -X GET 'https:\/\/api\.example\.com\/fx\/ok'/),
        ]);
        await tab.click({ role: "radio", name: "fetch" });
        await ctx.verify("fetch", [tab.shows(/await fetch\("https:\/\/api\.example\.com\/fx\/ok"/)]);
        await openPage(tab, `/modules/api/routes?${named("GET /fx/blob")}&tab=documentation`);
        await ctx.verify("a route never called", [
          tab.shows(/What was never called does not show\./),
          tab.shows(/EXAMPLE REQUEST/),
          tab.shows(/Nothing observed in the last 7 days, and no error code found in the handler's code\./),
          tab.shows(/size\s+string\s+no successful call yet/),
          tab.shows(/Inferred from|e\.g\./, { not: true, timeoutMs: 3000 }),
        ]);
      });
    },
  },
];
