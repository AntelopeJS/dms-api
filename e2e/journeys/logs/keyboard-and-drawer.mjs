import { check, list, mon, num, same, settled, text, traffic, raw, openPage } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */
/** @typedef {import("../../api.mjs").Tab} Tab */

const SEARCH = { role: "textbox", name: "Path, request ID, error…" };
const DRAWER = { role: "dialog" };

/**
 * Lets the page read the clipboard the way a user's own browser does once they allowed it.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<void>}
 */
async function allowClipboard(tab) {
  await tab.page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(tab.page.url()).origin });
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} What the clipboard holds
 */
function clipboardText(tab) {
  return tab.page.evaluate(() => navigator.clipboard.readText());
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The placeholder of the focused field, or the empty string when no field has the focus
 */
function focusedField(tab) {
  return tab.page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.placeholder : ""));
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<number | undefined>} The width of the open drawer in pixels
 */
async function drawerWidth(tab) {
  const box = await tab.locator(DRAWER).first().boundingBox();
  return box ? Math.round(box.width) : undefined;
}

/** The logs journeys about the keyboard, the clipboard and the drawer's width. */
export const keyboardAndDrawer = [
  {
    id: "slash-opens-the-request-search-and-question-mark-lists-the-shortcuts",
    title: "the slash key focuses the search of the Request logs and what is typed narrows the table; the question mark opens the list of the page's shortcuts, which Escape closes",
    entryPoint: "/modules/api/logs",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "two paths", [{ path: "/fx/ok", count: 2 }, { path: "/fx/missing", count: 1 }]);
      await settled(ctx, "the logs hold 3", "/logs", (body) => num(body, "total") === 3);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("before any key", [tab.visible({ role: "button", name: "All 3" }), tab.visible({ role: "dialog", name: "Keyboard shortcuts" }, { hidden: true, timeoutMs: 1500 })]);
      await tab.press("?");
      await ctx.verify("the question mark", [
        tab.visible({ role: "dialog", name: "Keyboard shortcuts" }),
        tab.shows(/Search the requests/),
        tab.shows(/Next \/ previous request in the panel/),
        tab.shows(/Close the panel/),
        tab.shows(/Live or Pause for the whole page/),
        tab.shows(/Show these shortcuts/),
      ]);
      await tab.press("Escape");
      await ctx.verify("Escape", [tab.visible({ role: "dialog", name: "Keyboard shortcuts" }, { hidden: true, timeoutMs: 4000 })]);
      await ctx.verify("the search has no focus yet", [same("the focused field", await focusedField(tab), "")]);
      await tab.press("/");
      await ctx.verify("the slash key", [tab.visible(SEARCH), same("the focused field", await focusedField(tab), "Path, request ID, error…")]);
      await tab.page.keyboard.type("missing");
      await ctx.verify("typing without a click", [
        same("the search holds what was typed", await tab.value(SEARCH), "missing"),
        tab.shows(/\/fx\/missing/),
        tab.shows(/\/fx\/ok/, { not: true, timeoutMs: 4000 }),
      ]);
    },
  },
  {
    id: "copy-curl-copies-the-open-request-as-a-command",
    title: "Copy cURL in the request drawer puts the open request on the clipboard as a curl command naming its method, its path with the query, its content type and body and the API origin, and says so in a toast",
    entryPoint: "/modules/api/logs?record=<id>",
    async run(/** @type {Ctx} */ ctx) {
      await raw(ctx, "a call with a query, a header and a body", { method: "POST", path: "/fx/orders/shop1/lines?limit=5", headers: { "content-type": "application/json", "x-tenant": "t1" }, body: JSON.stringify({ sku: "A1", quantity: 2 }) });
      const logs = await settled(ctx, "the call is logged", "/logs", (body) => num(body, "total") === 1);
      const detail = await mon(ctx, "the request in full", `/logs/${text(list(logs.body, "results")[0], "_id")}`);
      const origin = text(detail.body, "apiOrigin");
      await ctx.verify("the origin the console writes", [check("it is the API's or the dashboard's", origin === ctx.state.apiUrl || origin === ctx.state.webUrl, origin)]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await allowClipboard(tab);
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await tab.click({ role: "button", name: "Copy cURL" });
      const copied = await clipboardText(tab);
      await ctx.verify("the clipboard", [
        check("it is a curl command", /^curl\b/.test(copied), copied),
        check("it names the method", /-X POST\b/.test(copied), copied),
        check("it names the API origin and the path with its query", copied.includes(`${origin}/fx/orders/shop1/lines?limit=5`), copied),
        check("it carries the captured content type", /-H 'content-type: application\/json'/i.test(copied), copied),
        check("it carries the captured body", copied.includes(JSON.stringify({ sku: "A1", quantity: 2 })), copied),
        tab.shows(/cURL copied/),
      ]);
    },
  },
  {
    id: "dragging-the-drawers-left-edge-widens-it-and-it-opens-again-at-that-width",
    title: "dragging the left edge of the request drawer to the left widens it, the width is kept for the next opening, and the drawer opens again at that width after the page is reloaded",
    entryPoint: "/modules/api/logs?record=<id>",
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "two calls", [{ path: "/fx/ok", count: 2 }]);
      await settled(ctx, "the logs hold 2", "/logs", (body) => num(body, "total") === 2);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      const handle = tab.locator({ role: "separator", name: "Resize the drawer" });
      await handle.waitFor({ state: "visible", timeout: 15_000 });
      const before = await drawerWidth(tab);
      const grip = await handle.boundingBox();
      if (!grip) throw new Error("the drawer's edge has no box");
      const x = grip.x + grip.width / 2;
      const y = grip.y + grip.height / 2;
      await tab.page.mouse.move(x, y);
      await tab.page.mouse.down();
      await tab.page.mouse.move(x - 160, y, { steps: 12 });
      await tab.page.mouse.up();
      const widened = await drawerWidth(tab);
      await ctx.verify("the drag", [
        check("the drawer is wider after the drag", (widened ?? 0) >= (before ?? 0) + 120, { before, widened }),
        same("its edge reports the width", Number(await handle.getAttribute("aria-valuenow")), widened),
      ]);
      await tab.press("Escape");
      await ctx.verify("closed", [tab.visible(DRAWER, { hidden: true, timeoutMs: 8000 })]);
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      await ctx.verify("opened again", [check("the same width", (await drawerWidth(tab)) === widened, await drawerWidth(tab))]);
      await tab.reload();
      await tab.locator({ role: "separator", name: "Resize the drawer" }).waitFor({ state: "visible", timeout: 15_000 });
      await ctx.verify("after a reload", [check("the same width", (await drawerWidth(tab)) === widened, await drawerWidth(tab))]);
    },
  },
  {
    id: "an-open-row-or-an-active-search-holds-the-table-and-says-why",
    title: "while a request is open the table says Table on hold · row open, while a search narrows it Table on hold · search active, and the notice goes with the row and the search",
    entryPoint: "/modules/api/logs",
    knownFailures: {
      "an open request says the table is on hold, row open":
        "the request panel is a modal `drawer` target; the DMS names the `row open` hold only for a docked `sidePanel` target (useRowSidePanelContent), so an open request holds the table silently behind the '1 new request · Show' pill, and docs/4.usage/1.overview.md (Live mode) promises the notice",
    },
    async run(/** @type {Ctx} */ ctx) {
      await traffic(ctx, "two calls", [{ path: "/fx/ok", count: 2 }]);
      await settled(ctx, "the logs hold 2", "/logs", (body) => num(body, "total") === 2);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openPage(tab, "/modules/api/logs");
      await ctx.verify("live and nothing open", [tab.visible({ role: "button", name: "All 2" }), tab.shows(/Table on hold/, { not: true, timeoutMs: 2000 })]);
      await tab.press("/");
      await tab.page.keyboard.type("fx");
      await ctx.verify("a search", [tab.shows(/Table on hold · search active/)]);
      await tab.fill(SEARCH, "");
      await ctx.verify("the search cleared", [tab.shows(/Table on hold/, { not: true, timeoutMs: 4000 })]);
      await tab.click({ role: "button", name: "Open request", nth: 0 });
      const rowOpen = await tab.shows(/Table on hold · row open/, { timeoutMs: 3000 });
      await ctx.verify("a row open", [check("an open request says the table is on hold, row open", rowOpen.pass, rowOpen.pass ? "Table on hold · row open" : "no notice")]);
      await tab.press("Escape");
      await ctx.verify("the row closed", [tab.visible(DRAWER, { hidden: true, timeoutMs: 8000 }), tab.shows(/Table on hold/, { not: true, timeoutMs: 2000 })]);
    },
  },
];
