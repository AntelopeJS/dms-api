import { guarded } from "../guard.mjs";
import { check, isRow, list, mon, num, parseJson, pick, same, saveSettings, sendAndRead, settled, text, traffic } from "../api.mjs";

/** @typedef {import("../api.mjs").Ctx} Ctx */

const DEFAULT_HEADERS = ["content-type", "content-length", "user-agent", "accept", "accept-encoding", "host", "referer", "origin"];
const REDACTED_WORDS = ["password", "passwd", "secret", "authorization", "cookie", "apikey", "privatekey", "credential", "recoverycode", "backupcode", "cardnumber", "securitycode", "pincode", "token", "otp", "cvc", "cvv", "cvn", "iban", "pin", "pan", "ssn", "card"];
const JSON_HEADERS = { "content-type": "application/json", "user-agent": "verify-agent/1.0", "x-request-id": "req-capture-1", "x-webhook-signature": "sig-1", authorization: "Bearer top-secret", cookie: "sid=1", "proxy-authorization": "Basic cHJveHk6cHc=", "set-cookie": "sid=2", "x-api-key": "k-1", origin: "https://client.example.org", referer: "https://client.example.org/page" };

export const journeys = guarded([
  {
    id: "a-request-is-captured-with-its-facts",
    title: "a call to a project route is stored with its method, route pattern, raw path, path parameters, query, status, duration, client, request id, headers and bodies",
    entryPoint: "GET /api/monitoring/logs/:id after a call to /fx/*",
    async run(/** @type {Ctx} */ ctx) {
      const put = await sendAndRead(ctx, "PUT an item", { method: "PUT", path: "/fx/items/42?color=red&size=l", headers: JSON_HEADERS, body: JSON.stringify({ name: "chair" }) });
      const log = put.log;
      await ctx.verify("the stored request", [
        same("answered 200", put.status, 200),
        same("method", text(log, "method"), "PUT"),
        same("the route pattern", text(log, "uri"), "/fx/items/:id"),
        same("the raw path", text(log, "rawPath"), "/fx/items/42"),
        same("the path parameters", pick(log, "pathParams"), { id: "42" }),
        same("the query", pick(log, "query"), { color: "red", size: "l" }),
        same("the status", num(log, "statusCode"), 200),
        check("a duration was measured", (num(log, "responseTimeMs") ?? -1) >= 0, num(log, "responseTimeMs")),
        same("the client's user agent", text(log, "userAgent"), "verify-agent/1.0"),
        check("the client address is the loopback", /127\.0\.0\.1/.test(text(log, "ip")), text(log, "ip")),
        same("the request id comes from x-request-id", text(log, "requestId"), "req-capture-1"),
        same("the request body", text(log, "requestBody"), '{"name":"chair"}'),
        same("the response body", text(log, "responseBody"), '{"id":"42","body":{"name":"chair"}}'),
        same("the route is registered", pick(log, "routeRegistered"), true),
        same("the route reference", text(log, "route"), "PUT /fx/items/:id"),
      ]);
      const missing = await sendAndRead(ctx, "an unknown item", { path: "/fx/items/x9" });
      await ctx.verify("a client error", [same("status 404", num(missing.log, "statusCode"), 404), same("its message is the error shown", text(missing.log, "error", "message") || pick(missing.log, "error"), "no such item")]);
    },
  },
  {
    id: "a-thrown-error-keeps-its-message-and-its-stack",
    title: "a handler that throws is stored as a 500 with the error's message and stack, a thrown HTTP result with its message, and a clean call with no error",
    entryPoint: "GET /api/monitoring/logs/:id for /fx/boom, /fx/missing and /fx/ok",
    async run(/** @type {Ctx} */ ctx) {
      const boom = await sendAndRead(ctx, "boom", { path: "/fx/boom" });
      const missing = await sendAndRead(ctx, "missing", { path: "/fx/missing" });
      const ok = await sendAndRead(ctx, "ok", { path: "/fx/ok" });
      await ctx.verify("errors", [
        same("boom is a 500", num(boom.log, "statusCode"), 500),
        same("boom's message", text(boom.log, "error", "message"), "fixture boom: the invoice has no customer"),
        check("boom's stack names the handler", /fixture boom/.test(text(boom.log, "error", "stack")) && /boom/.test(text(boom.log, "error", "stack")), text(boom.log, "error", "stack").slice(0, 120)),
        same("missing is a 404", num(missing.log, "statusCode"), 404),
        same("missing's message is its body message", text(missing.log, "error", "message"), "fixture not found"),
        same("ok has no error", pick(ok.log, "error"), null),
      ]);
    },
  },
  {
    id: "the-consoles-own-and-the-dms-traffic-is-never-captured",
    title: "even under All routes, calls to /api/monitoring, /dms, the realtime channel and page layouts are neither logged nor counted",
    entryPoint: "GET /api/monitoring/logs under the All routes scope",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "watch all routes", { scope: "all" });
      await traffic(ctx, "one project call", [{ path: "/fx/ok", count: 1 }]);
      for (const path of ["/overview/health", "/logs", "/routes/list", "/settings/summary"]) await mon(ctx, `the console reads ${path}`, path);
      await ctx.api("a DMS call", { method: "GET", path: "/dms/pages/modules/api/overview/pagelayout" });
      await ctx.api("the onboarding probe", { method: "GET", path: "/api/onboarding/informations", as: "anon" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const logs = await settled(ctx, "the logs", "/logs?limit=200", (body) => list(body, "results").some((row) => text(row, "path") === "/api/onboarding/informations"));
      const paths = list(logs.body, "results").map((row) => text(row, "path"));
      await ctx.verify("what is stored", [
        check("the project call is stored", paths.includes("/fx/ok"), paths),
        check("a module route (the onboarding probe) is stored under All routes", paths.includes("/api/onboarding/informations"), paths),
        same("no /api/monitoring call is stored", paths.filter((path) => path.startsWith("/api/monitoring")), []),
        same("no /dms call is stored", paths.filter((path) => path.startsWith("/dms")), []),
        same("no page layout is stored", paths.filter((path) => path.endsWith("/pagelayout")), []),
        same("no realtime call is stored", paths.filter((path) => path.startsWith("/api/realtime")), []),
      ]);
    },
  },
  {
    id: "only-the-listed-headers-are-stored-and-secret-ones-never",
    title: "the default allow-list stores eight headers; a header added in the settings is stored from then on; authorization, cookie and API-key headers are refused in the list and never stored; an empty list stores none",
    entryPoint: "POST /api/monitoring/settings then /fx/ok with headers",
    async run(/** @type {Ctx} */ ctx) {
      const before = await sendAndRead(ctx, "default list", { path: "/fx/ok", headers: JSON_HEADERS });
      const stored = Object.keys(pick(before.log, "requestHeaders") ?? {}).sort();
      await ctx.verify("the default list", [
        same("the stored request headers", stored, ["accept", "accept-encoding", "content-type", "host", "origin", "referer", "user-agent"]),
        same("a header outside the list is absent", pick(before.log, "requestHeaders", "x-webhook-signature"), undefined),
        same("the allow-list in force", (await mon(ctx, "settings", "/settings")).body?.requestLogCaptureHeaders, DEFAULT_HEADERS),
      ]);
      const refusedList = await saveSettings(ctx, "a secret header in the list", { requestLogCaptureHeaders: ["x-webhook-signature", "authorization"] });
      await ctx.verify("a secret header is refused", [same("HTTP 400", refusedList.status, 400)]);
      const refusals = [];
      for (const header of ["cookie", "set-cookie", "x-api-key", "proxy-authorization", "x-antelopejs-api-source"]) refusals.push([header, (await saveSettings(ctx, `${header} in the list`, { requestLogCaptureHeaders: [header] })).status]);
      await ctx.verify("every credential header is refused", refusals.map(([header, status]) => same(`${String(header)} is refused`, status, 400)));
      const saved = await saveSettings(ctx, "add the webhook signature, in capitals", { requestLogCaptureHeaders: ["X-Webhook-Signature", "x-webhook-signature", "user-agent"] });
      await ctx.verify("stored lower case without repeats", [same("HTTP 200", saved.status, 200), same("the list", pick(saved.body, "requestLogCaptureHeaders"), ["x-webhook-signature", "user-agent"])]);
      const after = await sendAndRead(ctx, "custom list", { path: "/fx/ok", headers: JSON_HEADERS });
      await ctx.verify("the custom list", [
        same("the stored request headers", Object.keys(pick(after.log, "requestHeaders") ?? {}).sort(), ["user-agent", "x-webhook-signature"]),
        same("the signature value", pick(after.log, "requestHeaders", "x-webhook-signature"), "sig-1"),
        same("authorization is never stored", pick(after.log, "requestHeaders", "authorization"), undefined),
      ]);
      await saveSettings(ctx, "an empty list", { requestLogCaptureHeaders: [] });
      const none = await sendAndRead(ctx, "empty list", { path: "/fx/ok", headers: JSON_HEADERS });
      await ctx.verify("the empty list", [same("no request header is stored", pick(none.log, "requestHeaders"), {}), same("the override stays explicit", (await mon(ctx, "settings", "/settings")).body?.requestLogCaptureHeaders, [])]);
    },
  },
  {
    id: "values-under-secret-looking-keys-are-redacted-before-storage",
    title: "every key of the fixed list, in request bodies, response bodies and query strings, is stored as [REDACTED] and counted; other keys keep their values",
    entryPoint: "POST /fx/echo with one key per redacted word",
    async run(/** @type {Ctx} */ ctx) {
      const settings = await mon(ctx, "the fixed list", "/settings");
      const words = Array.isArray(pick(settings.body, "redactedKeys")) ? /** @type {string[]} */ (pick(settings.body, "redactedKeys")) : [];
      const fields = new Map([...words.map((word) => /** @type {const} */ ([word, `value-of-${word}`])), /** @type {const} */ (["name", "plain"])]);
      const body = { ...Object.fromEntries(fields), nested: { token: "deep", keep: "kept" } };
      const query = words.map((word) => `${word}=q-${word}`).join("&");
      const sent = await sendAndRead(ctx, "all the words", { method: "POST", path: `/fx/echo?${query}&page=2`, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const stored = parseJson(text(sent.log, "requestBody") || "{}");
      const echoed = parseJson(text(sent.log, "responseBody") || "{}");
      await ctx.verify("the list", [same("it is the 23 words the settings page shows", words, REDACTED_WORDS)]);
      await ctx.verify("request body", [
        ...words.map((word) => same(`${word} in the request body`, pick(stored, word), "[REDACTED]")),
        same("a plain key keeps its value", pick(stored, "name"), "plain"),
        same("a nested secret is redacted and its sibling kept", pick(stored, "nested"), { token: "[REDACTED]", keep: "kept" }),
        same("the response body echoes it redacted too", pick(echoed, "password"), "[REDACTED]"),
      ]);
      await ctx.verify("query string", [
        ...words.map((word) => same(`${word} in the query`, pick(sent.log, "query", word), "[REDACTED]")),
        same("a plain parameter keeps its value", pick(sent.log, "query", "page"), "2"),
      ]);
      await ctx.verify("the counts", [same("query", pick(sent.log, "redactions", "query"), words.length), same("request body", pick(sent.log, "redactions", "requestBody"), words.length + 1), same("response body", pick(sent.log, "redactions", "responseBody"), words.length + 1)]);
    },
  },
  {
    id: "bodies-above-the-cap-are-stored-truncated-and-flagged",
    title: "a body of exactly the cap is stored whole, one byte more is stored cut with the full size, the cap applies to responses too, and a cap of 0 turns body capture off",
    entryPoint: "POST /api/monitoring/settings requestLogMaxBodyKb then /fx/echo",
    async run(/** @type {Ctx} */ ctx) {
      await saveSettings(ctx, "cap at 1 KB", { requestLogMaxBodyKb: 1 });
      const exact = JSON.stringify({ a: "x".repeat(1024 - 8) });
      const over = JSON.stringify({ a: "x".repeat(1024 - 7) });
      const atCap = await sendAndRead(ctx, "exactly 1024 bytes", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: exact });
      const aboveCap = await sendAndRead(ctx, "1025 bytes", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: over });
      await ctx.verify("the cap", [
        same("the body at the cap is whole", [Buffer.byteLength(exact), text(atCap.log, "requestBody") === exact, pick(atCap.log, "requestBodyTruncated")], [1024, true, false]),
        same("the body above the cap is flagged", pick(aboveCap.log, "requestBodyTruncated"), true),
        same("it keeps the first 1024 bytes", text(aboveCap.log, "requestBody"), over.slice(0, 1024)),
        same("it records the whole size", [Buffer.byteLength(over), pick(aboveCap.log, "requestBodySize")], [1025, 1025]),
        same("the echoed response is cut too", [pick(aboveCap.log, "responseBodyTruncated"), text(aboveCap.log, "responseBody").length], [true, 1024]),
      ]);
      await saveSettings(ctx, "no body capture", { requestLogMaxBodyKb: 0 });
      const off = await sendAndRead(ctx, "capture off", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: exact });
      await ctx.verify("a cap of 0", [same("no request body is stored", pick(off.log, "requestBody"), null), same("no response body is stored", pick(off.log, "responseBody"), null), check("the status is still stored", pick(off.log, "statusCode") === 201, pick(off.log, "statusCode"))]);
    },
  },
  {
    id: "a-key-is-secret-by-the-words-it-is-made-of",
    title: "keys such as clientSecret, x-api-key, accessToken, userPin, creditCard and card_cvc2 are redacted, short look-alikes such as spin, footprint, company and cardBrand are not, and a payment card number is redacted whatever its key",
    entryPoint: "POST /fx/echo with keys and values",
    async run(/** @type {Ctx} */ ctx) {
      const redactedKeys = ["clientSecret", "x-api-key", "accessToken", "access_token", "accesstoken", "refreshtoken", "userPin", "creditCard", "card_cvc2", "myPassword", "iban", "totp", "X-Authorization"];
      const keptKeys = ["spin", "footprint", "isNotPaid", "company", "cardBrand", "tokenizer", "pinned", "panda", "cvcs"];
      const body = { ...Object.fromEntries(redactedKeys.map((key) => [key, "v-" + key])), ...Object.fromEntries(keptKeys.map((key) => [key, "v-" + key])), memo: "4111 1111 1111 1111", ref: "4111111111111111", short: "411111111111", note: "order 12345" };
      const sent = await sendAndRead(ctx, "keys", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const stored = parseJson(text(sent.log, "requestBody") || "{}");
      await ctx.verify("secret keys", redactedKeys.map((key) => same(`${key} is redacted`, pick(stored, key), "[REDACTED]")));
      await ctx.verify("look-alikes", keptKeys.map((key) => same(`${key} keeps its value`, pick(stored, key), "v-" + key)));
      await ctx.verify("card numbers", [
        same("a spaced card number is redacted whatever its key", pick(stored, "memo"), "[REDACTED]"),
        same("a plain card number is redacted", pick(stored, "ref"), "[REDACTED]"),
        same("twelve digits are not a card number", pick(stored, "short"), "411111111111"),
        same("other text is kept", pick(stored, "note"), "order 12345"),
      ]);
    },
  },
  {
    id: "secrets-and-card-numbers-are-redacted-wherever-they-sit",
    title: "card numbers and credential keys are redacted in query values (repeated ones too), form bodies, JSON arrays and nested arrays, at their count; invalid or look-alike digits are kept; bodies that are not JSON or form data, malformed JSON and bare JSON strings are not stored",
    entryPoint: "GET /api/monitoring/logs/:id after calls to /fx/ok and /fx/echo",
    async run(/** @type {Ctx} */ ctx) {
      const query = await sendAndRead(ctx, "query values", { path: "/fx/ok?memo=4111111111111111&dash=4111-1111-1111-1111&sp=4111%201111%201111%201111&bad=4111111111111112&ms=1700000000000&amex=378282246310005&mc=5555555555554444&rep=1&rep=5555555555554444&token=abc&page=2&text=order%204111%201111%201111%201111%20paid" });
      await ctx.verify("the query string", [
        same("a plain card number", pick(query.log, "query", "memo"), "[REDACTED]"),
        same("a card number with dashes", pick(query.log, "query", "dash"), "[REDACTED]"),
        same("a card number with spaces", pick(query.log, "query", "sp"), "[REDACTED]"),
        same("an American Express number", pick(query.log, "query", "amex"), "[REDACTED]"),
        same("a Mastercard number", pick(query.log, "query", "mc"), "[REDACTED]"),
        same("16 digits that fail the Luhn check are kept", pick(query.log, "query", "bad"), "4111111111111112"),
        same("an epoch in milliseconds is kept", pick(query.log, "query", "ms"), "1700000000000"),
        same("a repeated parameter keeps its plain value and redacts its card", pick(query.log, "query", "rep"), ["1", "[REDACTED]"]),
        same("a credential key", pick(query.log, "query", "token"), "[REDACTED]"),
        same("a plain parameter", pick(query.log, "query", "page"), "2"),
        same("a card number inside a sentence", pick(query.log, "query", "text"), "order [REDACTED] paid"),
        same("the count: memo, dash, sp, amex, mc, rep, token, text", pick(query.log, "redactions", "query"), 8),
      ]);
      const form = await sendAndRead(ctx, "form body", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "memo=4111111111111111&name=plain&password=x&amex=378282246310005&bad=4111111111111112" });
      await ctx.verify("a form body", [
        same("the stored form", text(form.log, "requestBody"), "memo=%5BREDACTED%5D&name=plain&password=%5BREDACTED%5D&amex=%5BREDACTED%5D&bad=4111111111111112"),
        same("the count", pick(form.log, "redactions", "requestBody"), 3),
      ]);
      const nested = await sendAndRead(ctx, "arrays", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ password: "p", keep: "k" }], cards: ["4111 1111 1111 1111", "plain"], n: [4111111111111111], m: 1700000000000, nest: [[{ token: "t", ok: 1 }]] }) });
      await ctx.verify("arrays", [
        same("the stored body", parseJson(text(nested.log, "requestBody")), { items: [{ password: "[REDACTED]", keep: "k" }], cards: ["[REDACTED]", "plain"], n: ["[REDACTED]"], m: 1700000000000, nest: [[{ token: "[REDACTED]", ok: 1 }]] }),
        same("the request count", pick(nested.log, "redactions", "requestBody"), 4),
        same("the response is redacted the same way", pick(nested.log, "redactions", "responseBody"), 4),
        same("the stored response", parseJson(text(nested.log, "responseBody")), parseJson(text(nested.log, "requestBody"))),
      ]);
      /** @type {Record<string, unknown>} */
      let deep = { leaf: "x" };
      for (let level = 0; level < 40; level += 1) deep = { next: deep };
      const tall = await sendAndRead(ctx, "forty levels", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: JSON.stringify(deep) });
      let walk = parseJson(text(tall.log, "requestBody"));
      let levels = 0;
      while (isRow(walk) && "next" in walk) {
        walk = walk.next;
        levels += 1;
      }
      await ctx.verify("a body nested deeper than 32 levels", [same("it stops at level 32 with a redaction", [levels, walk], [32, "[REDACTED]"])]);
      const notJson = await sendAndRead(ctx, "text body", { method: "POST", path: "/fx/echo", headers: { "content-type": "text/plain" }, body: "token=abc" });
      const malformed = await sendAndRead(ctx, "malformed JSON", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: '{"password":' });
      const bare = await sendAndRead(ctx, "bare string", { method: "POST", path: "/fx/echo", headers: { "content-type": "application/json" }, body: '"sk_live_abc"' });
      await ctx.verify("bodies that cannot be redacted by key", [
        same("text/plain is not stored", [pick(notJson.log, "requestBody"), pick(notJson.log, "requestBodyOmitted")], [null, "not-json"]),
        same("malformed JSON is not stored", [pick(malformed.log, "requestBody"), pick(malformed.log, "requestBodyOmitted")], [null, "malformed"]),
        same("a bare JSON string is not stored", [pick(bare.log, "requestBody"), pick(bare.log, "requestBodyOmitted")], [null, "not-json"]),
      ]);
    },
  },
]);
