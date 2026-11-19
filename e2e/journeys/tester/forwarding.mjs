import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveSettings, check, isRow, list, member, mon, num, parseJson, pick, raw, same, settled, text } from "../../api.mjs";

/** @typedef {import("../../api.mjs").Ctx} Ctx */
/** @typedef {import("../../api.mjs").Tab} Tab */

/** The Tester journey about its forwarding route, called directly. */
export const forwarding = [
  {
    id: "the-forwarding-route-refuses-unsafe-paths-and-never-forwards-blocked-headers",
    title: "POST /api/_dms-api/tester answers 401 without a session and 403 to a member or from another origin, refuses a path that leaves the API (a second slash, a dot segment, an encoded one, a backslash, a fragment, a control character) and a method or a body it does not allow with 400, forwards no Host, Origin, Referer, Forwarded or X-Forwarded-For header to the API while it forwards the others, and fails an answer above 64 KB",
    entryPoint: "POST /api/_dms-api/tester",
    async run(/** @type {Ctx} */ ctx) {
      const defaults = ["content-type", "content-length", "user-agent", "accept", "accept-encoding", "host", "referer", "origin"];
      await saveSettings(ctx, "capture the headers the Tester must not forward", { requestLogCaptureHeaders: [...defaults, "x-forwarded-for", "forwarded", "via", "x-dms-probe", "x-method-override", "x-kept"] });
      await member(ctx, "plain", []);
      const route = `${ctx.state.webUrl}/api/_dms-api/tester`;
      const owner = await ctx.tab("admin", "owner");
      await owner.signIn("admin");
      const plain = await ctx.tab("plain");
      await plain.signIn("plain");
      /**
       * @param {Tab} tab The signed-in tab whose session the call carries
       * @param {string} label What the call does
       * @param {unknown} data The JSON the route is posted
       * @param {string} [origin] The Origin header, the dashboard's own by default
       * @returns {Promise<{ status: number, json: unknown }>} The answer
       */
      const forward = async (tab, label, data, origin = ctx.state.webUrl) => {
        const folder = ctx.step(label);
        const response = await tab.page.request.post(route, { data, headers: { origin }, failOnStatusCode: false });
        const body = await response.text();
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "request.json"), `${JSON.stringify({ method: "POST", url: route, origin, data }, null, 2)}\n`);
        writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status(), body: body.slice(0, 4000) }, null, 2)}\n`);
        return { status: response.status(), json: parseJson(body) };
      };
      const call = { method: "GET", path: "/fx/ok", headers: {}, useSession: false };
      const anonymous = await raw(ctx, "no session", { origin: "web", method: "POST", path: "/api/_dms-api/tester", headers: { "content-type": "application/json", origin: ctx.state.webUrl }, body: JSON.stringify(call) });
      const member403 = await forward(plain, "a member's session", call);
      const allowed = await forward(owner, "a plain call", call);
      const foreign = await forward(owner, "a call from another origin", call, "https://evil.example");
      await ctx.verify("who may forward", [
        same("another origin, even with the owner's session: 403", [foreign.status, text(foreign.json, "error")], [403, "Forbidden"]),
        same("without a session: 401", [anonymous.status, text(anonymous.json, "error")], [401, "Not authenticated"]),
        same("a member's session: 403", [member403.status, text(member403.json, "error")], [403, "Forbidden"]),
        same("the owner's call is forwarded and answered by the route", [allowed.status, num(allowed.json, "status")], [200, 200]),
      ]);
      const unsafe = ["//evil.example/fx/ok", "https://evil.example/fx/ok", "fx/ok", "/fx/../fx/ok", "/fx/%2e%2e/ok", "/fx/%252e%252e/ok", "/fx/a%2Fb", "/fx\\ok", "/fx/ok#fragment", "/fx/ok\nx", "/fx/ok x"];
      /** @type {[string, number][]} */
      const refused = [];
      for (const path of unsafe) refused.push([path, (await forward(owner, `the path ${JSON.stringify(path)}`, { ...call, path })).status]);
      await ctx.verify("unsafe paths", refused.map(([path, status]) => same(`${JSON.stringify(path)} is refused with 400`, status, 400)));
      /** @type {[string, unknown][]} */
      const others = [
        ["a method the route does not allow", { ...call, method: "TRACE" }],
        ["a body on a GET", { ...call, body: "{}" }],
        ["a header value that is not text", { ...call, headers: { "x-kept": 1 } }],
        ["no useSession", { method: "GET", path: "/fx/ok", headers: {} }],
        ["headers that are not an object", { ...call, headers: [] }],
      ];
      /** @type {[string, number][]} */
      const invalid = [];
      for (const [label, data] of others) invalid.push([label, (await forward(owner, label, data)).status]);
      await ctx.verify("invalid calls", invalid.map(([label, status]) => same(`${label} is refused with 400`, status, 400)));
      const probe = await forward(owner, "a call with blocked headers", { method: "GET", path: "/fx/items/probe", headers: { host: "evil.example", origin: "https://evil.example", referer: "https://evil.example/page", "x-forwarded-for": "6.6.6.6", forwarded: "for=6.6.6.6", via: "1.1 evil", "x-dms-probe": "1", "x-method-override": "DELETE", "x-kept": "kept" }, useSession: false });
      const logs = await settled(ctx, "the forwarded call is logged", "/logs?limit=20&filter_path=is:%2Ffx%2Fitems%2Fprobe", (body) => list(body, "results").length === 1);
      const stored = await mon(ctx, "the forwarded call in full", `/logs/${text(list(logs.body, "results")[0], "_id")}`);
      const headers = pick(stored.body, "requestHeaders");
      const received = isRow(headers) ? Object.keys(headers) : [];
      await ctx.verify("blocked headers", [
        same("the route answered", probe.status, 200),
        same("the header that is not blocked arrives", pick(headers, "x-kept"), "kept"),
        check("no blocked header arrives", ["host", "origin", "referer", "x-forwarded-for", "forwarded", "via", "x-dms-probe", "x-method-override"].every((name) => name === "host" ? pick(headers, name) !== "evil.example" : pick(headers, name) === undefined), received),
      ]);
      const small = await forward(owner, "an answer of 60 KB", { ...call, path: "/fx/blob?size=60000" });
      const large = await forward(owner, "an answer of 70 KB", { ...call, path: "/fx/blob?size=70000" });
      await ctx.verify("the answer limit", [
        same("60 KB comes back whole", [small.status, num(small.json, "status")], [200, 200]),
        same("70 KB fails the call with 502", [large.status, text(large.json, "error")], [502, "DMS tester request failed"]),
      ]);
    },
  },
];
