import { FIXTURE_ROUTES, check, list, mon, num, raw, same, settled, text, openPage } from "../../api.mjs";
import { named } from "./shared.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */

const FILTER = { role: "textbox", name: "Filter by path or handler" };

/** The routes journeys about the keyboard and the clipboard. */
export const keyboardAndClipboard = [
  {
    id: "slash-opens-the-route-filter",
    title: "the slash key opens the list of routes and puts the focus in its filter, and what is typed narrows the tree",
    entryPoint: "/modules/api/routes",
    async run(/** @type {Ctx} */ ctx) {
      await raw(ctx, "a call so a route is selected", { path: "/fx/boom" });
      await settled(ctx, "the tree", "/routes/list", (body) => list(body, "routes").some((row) => text(row, "ref") === "GET /fx/boom" && num(row, "requests") === 1));
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/routes");
      await ctx.verify("the filter is folded away", [tab.visible(FILTER, { hidden: true, timeoutMs: 3000 })]);
      await tab.press("/");
      const focused = await tab.page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.placeholder : ""));
      await ctx.verify("the slash key", [tab.visible(FILTER), same("the focused field", focused, "Filter by path or handler")]);
      await tab.page.keyboard.type("items");
      await ctx.verify("typing without a click", [same("the filter holds what was typed", await tab.value(FILTER), "items"), tab.shows(new RegExp(`3 of ${FIXTURE_ROUTES} routes · 1 folder`))]);
    },
  },
  {
    id: "copy-curl-on-a-route-copies-an-example-call",
    title: "Copy cURL in a route's header puts an example call on the clipboard: its method, the API origin, the path and query of the last call it answered and its body, and says so in a toast",
    entryPoint: "/modules/api/routes?route=POST /fx/orders/:shop/lines",
    async run(/** @type {Ctx} */ ctx) {
      const ref = "POST /fx/orders/:shop/lines";
      await raw(ctx, "a call", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      await settled(ctx, "the route is called", `/routes/detail?${named(ref)}`, (body) => num(body, "contract", "exampleBody", "quantity") === 2 || text(body, "state") !== "idle");
      const detail = await mon(ctx, "the route", `/routes/detail?${named(ref)}`);
      const origin = text(detail.body, "apiOrigin");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, `/modules/api/routes?${named(ref)}`);
      await tab.page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(tab.page.url()).origin });
      await tab.click({ role: "button", name: "Copy cURL" });
      const copied = await tab.page.evaluate(() => navigator.clipboard.readText());
      await ctx.verify("the clipboard", [
        check("it is a curl command", /^curl\b/.test(copied), copied),
        check("it names the method", /-X POST\b/.test(copied), copied),
        check("it names the API origin and the example path and query", copied.includes(`${origin}/fx/orders/shop1/lines?limit=5`), copied),
        check("it carries the example body", copied.includes(JSON.stringify({ sku: "A1", quantity: 2 })), copied),
        tab.shows(/cURL copied/),
      ]);
    },
  },
];
