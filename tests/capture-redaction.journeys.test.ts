import { describe, expect } from "vitest";
import { z } from "zod";
import { type Dms, test } from "./helpers/dms";
import { type Json, parseBody } from "./helpers/json";

const DEFAULT_HEADERS = [
  "content-type",
  "content-length",
  "user-agent",
  "accept",
  "accept-encoding",
  "host",
  "referer",
  "origin",
];

const REDACTED_WORDS = [
  "password",
  "passwd",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "privatekey",
  "credential",
  "recoverycode",
  "backupcode",
  "cardnumber",
  "securitycode",
  "pincode",
  "token",
  "otp",
  "cvc",
  "cvv",
  "cvn",
  "iban",
  "pin",
  "pan",
  "ssn",
  "card",
];

const JSON_HEADERS = {
  "content-type": "application/json",
  "user-agent": "fixture-agent/1.0",
  "x-request-id": "req-capture-1",
  "x-webhook-signature": "sig-1",
  authorization: "Bearer top-secret",
  cookie: "sid=1",
  "proxy-authorization": "Basic cHJveHk6cHc=",
  "set-cookie": "sid=2",
  "x-api-key": "k-1",
  origin: "https://client.example.org",
  referer: "https://client.example.org/page",
};

const REDACTED = "[REDACTED]";

const DEFAULT_STORED = [
  "accept",
  "accept-encoding",
  "content-type",
  "host",
  "origin",
  "referer",
  "user-agent",
];

const capSchema = z.object({
  requestBody: z.string().nullable(),
  requestBodyTruncated: z.boolean(),
  requestBodySize: z.number().nullable(),
  responseBody: z.string().nullable(),
  responseBodyTruncated: z.boolean(),
});

const bodiesSchema = z.object({
  requestBody: z.string().nullish(),
  responseBody: z.string().nullish(),
});

interface Depth {
  levels: number;
  leaf: string;
}

const depthSchema: z.ZodType<Depth, Json> = z.lazy(() =>
  z.union([
    z.string().transform((leaf) => ({ levels: 0, leaf })),
    z
      .object({ next: depthSchema })
      .transform(({ next }) => ({ levels: next.levels + 1, leaf: next.leaf })),
  ]),
);

/** The body a stored request log holds, parsed as the module stored it; `{}` when it stored none. */
function storedBody(log: Json, field: "requestBody" | "responseBody"): Json {
  const stored = bodiesSchema.parse(log)[field];
  return stored ? parseBody(stored) : {};
}

function storedHeaders(log: Json): string[] {
  return Object.keys(
    z.object({ requestHeaders: z.record(z.string(), z.string()) }).parse(log)
      .requestHeaders,
  ).sort();
}

function echo(dms: Dms, body: string, contentType = "application/json") {
  return dms.sendAndRead({
    method: "POST",
    path: "/fx/echo",
    headers: { "content-type": contentType },
    body,
  });
}

const CREDENTIAL_HEADERS = [
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
  "x-antelopejs-api-source",
];

/** What the settings route answers to each header offered alone as the capture allow-list. */
async function offeredAlone(
  dms: Dms,
  headers: string[],
): Promise<Map<string, number>> {
  const statuses = new Map<string, number>();
  for (const header of headers) {
    const answer = await dms.saveSettings({
      requestLogCaptureHeaders: [header],
    });
    statuses.set(header, answer.status);
  }
  return statuses;
}

const KEPT_KEYS = [
  "spin",
  "footprint",
  "isNotPaid",
  "company",
  "cardBrand",
  "tokenizer",
  "pinned",
  "panda",
  "cvcs",
];

const SECRET_KEYS = [
  "clientSecret",
  "x-api-key",
  "accessToken",
  "access_token",
  "accesstoken",
  "refreshtoken",
  "userPin",
  "creditCard",
  "card_cvc2",
  "myPassword",
  "iban",
  "totp",
  "X-Authorization",
];

const CARD_QUERY =
  "/fx/ok?memo=4111111111111111&dash=4111-1111-1111-1111&sp=4111%201111%201111%201111&bad=4111111111111112&ms=1700000000000&amex=378282246310005&mc=5555555555554444&rep=1&rep=5555555555554444&token=abc&page=2&text=order%204111%201111%201111%201111%20paid";

const QUERY_VALUES: [string, string, string][] = [
  ["a plain card number", "memo", REDACTED],
  ["a card number with dashes", "dash", REDACTED],
  ["a card number with spaces", "sp", REDACTED],
  ["an American Express number", "amex", REDACTED],
  ["a Mastercard number", "mc", REDACTED],
  ["16 digits that fail the Luhn check are kept", "bad", "4111111111111112"],
  ["an epoch in milliseconds is kept", "ms", "1700000000000"],
  ["a credential key", "token", REDACTED],
  ["a plain parameter", "page", "2"],
  ["a card number inside a sentence", "text", `order ${REDACTED} paid`],
];

const FORM_BODY =
  "memo=4111111111111111&name=plain&password=x&amex=378282246310005&bad=4111111111111112";

const FORM_STORED =
  "memo=%5BREDACTED%5D&name=plain&password=%5BREDACTED%5D&amex=%5BREDACTED%5D&bad=4111111111111112";

const ARRAYS_BODY = JSON.stringify({
  items: [{ password: "p", keep: "k" }],
  cards: ["4111 1111 1111 1111", "plain"],
  n: [4111111111111111],
  m: 1700000000000,
  nest: [[{ token: "t", ok: 1 }]],
});

const ARRAYS_STORED = {
  items: [{ password: REDACTED, keep: "k" }],
  cards: [REDACTED, "plain"],
  n: [REDACTED],
  m: 1700000000000,
  nest: [[{ token: REDACTED, ok: 1 }]],
};

function nestedDeeperThanTheLimit(): string {
  let deep: Json = { leaf: "x" };
  for (let level = 0; level < 40; level += 1) deep = { next: deep };
  return JSON.stringify(deep);
}

describe("capture", () => {
  test("only-the-listed-headers-are-stored-and-secret-ones-never", async ({
    dms,
  }) => {
    const send = () =>
      dms.sendAndRead({ path: "/fx/ok", headers: JSON_HEADERS });
    const before = await send();
    expect
      .soft(storedHeaders(before.log), "the stored request headers")
      .toEqual(DEFAULT_STORED);
    expect
      .soft(before.log, "a header outside the list is absent")
      .not.toHaveProperty(["requestHeaders", "x-webhook-signature"]);
    expect
      .soft((await dms.mon("/settings")).body, "the allow-list in force")
      .toMatchObject({ requestLogCaptureHeaders: DEFAULT_HEADERS });

    const refusedList = await dms.saveSettings({
      requestLogCaptureHeaders: ["x-webhook-signature", "authorization"],
    });
    expect
      .soft(refusedList.status, "a secret header is refused: HTTP 400")
      .toBe(400);
    for (const [header, status] of await offeredAlone(dms, CREDENTIAL_HEADERS))
      expect.soft(status, `${header} is refused`).toBe(400);

    const saved = await dms.saveSettings({
      requestLogCaptureHeaders: [
        "X-Webhook-Signature",
        "x-webhook-signature",
        "user-agent",
      ],
    });
    expect.soft(saved.status, "HTTP 200").toBe(200);
    expect.soft(saved.body, "stored lower case without repeats").toMatchObject({
      requestLogCaptureHeaders: ["x-webhook-signature", "user-agent"],
    });
    const after = await send();
    expect
      .soft(storedHeaders(after.log), "the stored request headers")
      .toEqual(["user-agent", "x-webhook-signature"]);
    expect
      .soft(after.log, "the signature value")
      .toHaveProperty(["requestHeaders", "x-webhook-signature"], "sig-1");
    expect
      .soft(after.log, "authorization is never stored")
      .not.toHaveProperty(["requestHeaders", "authorization"]);

    await dms.saveSettings({ requestLogCaptureHeaders: [] });
    expect
      .soft(storedHeaders((await send()).log), "no request header is stored")
      .toEqual([]);
    expect
      .soft((await dms.mon("/settings")).body, "the override stays explicit")
      .toMatchObject({ requestLogCaptureHeaders: [] });
  });
});

describe("capture", () => {
  test("values-under-secret-looking-keys-are-redacted-before-storage", async ({
    dms,
  }) => {
    const words = z
      .object({ redactedKeys: z.array(z.string()) })
      .parse((await dms.mon("/settings")).body).redactedKeys;
    const body = {
      ...Object.fromEntries(words.map((word) => [word, `value-of-${word}`])),
      name: "plain",
      nested: { token: "deep", keep: "kept" },
    };
    const query = words.map((word) => `${word}=q-${word}`).join("&");
    const sent = await dms.sendAndRead({
      method: "POST",
      path: `/fx/echo?${query}&page=2`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const stored = storedBody(sent.log, "requestBody");

    expect
      .soft(words, "it is the 23 words the settings page shows")
      .toEqual(REDACTED_WORDS);
    for (const word of words)
      expect
        .soft(stored, `${word} in the request body`)
        .toHaveProperty([word], REDACTED);
    expect
      .soft(stored, "a plain key keeps its value")
      .toHaveProperty(["name"], "plain");
    expect
      .soft(stored, "a nested secret is redacted and its sibling kept")
      .toHaveProperty(["nested"], { token: REDACTED, keep: "kept" });
    expect
      .soft(
        storedBody(sent.log, "responseBody"),
        "the response body echoes it redacted too",
      )
      .toHaveProperty(["password"], REDACTED);
    for (const word of words)
      expect
        .soft(sent.log, `${word} in the query`)
        .toHaveProperty(["query", word], REDACTED);
    expect
      .soft(sent.log, "a plain parameter keeps its value")
      .toHaveProperty(["query", "page"], "2");
    expect
      .soft(sent.log, "the count of query")
      .toHaveProperty(["redactions", "query"], words.length);
    expect
      .soft(sent.log, "the count of request body")
      .toHaveProperty(["redactions", "requestBody"], words.length + 1);
    expect
      .soft(sent.log, "the count of response body")
      .toHaveProperty(["redactions", "responseBody"], words.length + 1);
  });
});

describe("capture", () => {
  test("bodies-above-the-cap-are-stored-truncated-and-flagged", async ({
    dms,
  }) => {
    await dms.saveSettings({ requestLogMaxBodyKb: 1 });
    const exact = JSON.stringify({ a: "x".repeat(1024 - 8) });
    const over = JSON.stringify({ a: "x".repeat(1024 - 7) });
    const atCap = capSchema.parse((await echo(dms, exact)).log);
    const cut = capSchema.parse((await echo(dms, over)).log);

    expect
      .soft(
        [
          Buffer.byteLength(exact),
          atCap.requestBody === exact,
          atCap.requestBodyTruncated,
        ],
        "the body at the cap is whole",
      )
      .toEqual([1024, true, false]);
    expect
      .soft(cut.requestBodyTruncated, "the body above the cap is flagged")
      .toBe(true);
    expect
      .soft(cut.requestBody, "it keeps the first 1024 bytes")
      .toBe(over.slice(0, 1024));
    expect
      .soft(
        [Buffer.byteLength(over), cut.requestBodySize],
        "it records the whole size",
      )
      .toEqual([1025, 1025]);
    expect
      .soft(
        [cut.responseBodyTruncated, cut.responseBody?.length],
        "the echoed response is cut too",
      )
      .toEqual([true, 1024]);

    await dms.saveSettings({ requestLogMaxBodyKb: 0 });
    const off = (await echo(dms, exact)).log;
    expect
      .soft(off, "no request body is stored")
      .toMatchObject({ requestBody: null });
    expect
      .soft(off, "no response body is stored")
      .toMatchObject({ responseBody: null });
    expect
      .soft(off, "the status is still stored")
      .toMatchObject({ statusCode: 201 });
  });
});

describe("capture", () => {
  test("a-key-is-secret-by-the-words-it-is-made-of", async ({ dms }) => {
    const body = {
      ...Object.fromEntries(SECRET_KEYS.map((key) => [key, `v-${key}`])),
      ...Object.fromEntries(KEPT_KEYS.map((key) => [key, `v-${key}`])),
      memo: "4111 1111 1111 1111",
      ref: "4111111111111111",
      short: "411111111111",
      note: "order 12345",
    };
    const stored = storedBody(
      (await echo(dms, JSON.stringify(body))).log,
      "requestBody",
    );

    for (const key of SECRET_KEYS)
      expect.soft(stored, `${key} is redacted`).toHaveProperty([key], REDACTED);
    for (const key of KEPT_KEYS)
      expect
        .soft(stored, `${key} keeps its value`)
        .toHaveProperty([key], `v-${key}`);
    expect
      .soft(stored, "a spaced card number is redacted whatever its key")
      .toHaveProperty(["memo"], REDACTED);
    expect
      .soft(stored, "a plain card number is redacted")
      .toHaveProperty(["ref"], REDACTED);
    expect
      .soft(stored, "twelve digits are not a card number")
      .toHaveProperty(["short"], "411111111111");
    expect
      .soft(stored, "other text is kept")
      .toHaveProperty(["note"], "order 12345");
  });
});

describe("capture", () => {
  test("secrets-and-card-numbers-are-redacted-wherever-they-sit", async ({
    dms,
  }) => {
    const query = await dms.sendAndRead({ path: CARD_QUERY });
    for (const [name, key, value] of QUERY_VALUES)
      expect.soft(query.log, name).toHaveProperty(["query", key], value);
    expect
      .soft(
        query.log,
        "a repeated parameter keeps its plain value and redacts its card",
      )
      .toHaveProperty(["query", "rep"], ["1", REDACTED]);
    expect
      .soft(query.log, "the count: memo, dash, sp, amex, mc, rep, token, text")
      .toHaveProperty(["redactions", "query"], 8);

    const form = await echo(
      dms,
      FORM_BODY,
      "application/x-www-form-urlencoded",
    );
    expect
      .soft(form.log, "the stored form")
      .toHaveProperty(["requestBody"], FORM_STORED);
    expect
      .soft(form.log, "the count")
      .toHaveProperty(["redactions", "requestBody"], 3);

    const nested = await echo(dms, ARRAYS_BODY);
    const nestedBody = storedBody(nested.log, "requestBody");
    expect.soft(nestedBody, "the stored body").toEqual(ARRAYS_STORED);
    expect
      .soft(nested.log, "the request count")
      .toHaveProperty(["redactions", "requestBody"], 4);
    expect
      .soft(nested.log, "the response is redacted the same way")
      .toHaveProperty(["redactions", "responseBody"], 4);
    expect
      .soft(storedBody(nested.log, "responseBody"), "the stored response")
      .toEqual(nestedBody);

    const tall = await echo(dms, nestedDeeperThanTheLimit());
    expect
      .soft(
        depthSchema.parse(storedBody(tall.log, "requestBody")),
        "it stops at level 32 with a redaction",
      )
      .toEqual({ levels: 32, leaf: REDACTED });

    const notJson = await echo(dms, "token=abc", "text/plain");
    const malformed = await echo(dms, '{"password":');
    const bare = await echo(dms, '"sk_live_abc"');
    expect
      .soft(notJson.log, "text/plain is not stored")
      .toMatchObject({ requestBody: null, requestBodyOmitted: "not-json" });
    expect
      .soft(malformed.log, "malformed JSON is not stored")
      .toMatchObject({ requestBody: null, requestBodyOmitted: "malformed" });
    expect
      .soft(bare.log, "a bare JSON string is not stored")
      .toMatchObject({ requestBody: null, requestBodyOmitted: "not-json" });
  });
});
