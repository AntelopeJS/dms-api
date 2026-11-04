import { describe, expect, it } from "vitest";
import {
  isCardNumber,
  isSensitiveKey,
  passesLuhn,
  redactSearchParams,
  redactValue,
  sanitizeBody,
} from "@/services/request-log/redaction";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "X-Api-Key",
    "portal_token",
    "accessToken",
    "accesstoken",
    "clientSecret",
    "cardNumber",
    "card_number",
    "card_cvc",
    "cvc",
    "CVV2",
    "iban",
    "customerIban",
    "card",
    "creditCard",
    "pin",
    "userPin",
    "pan",
    "ssn",
    "otp",
    "otpCode",
    "totp",
    "recovery_codes",
    "set-cookie",
    "authorization",
  ])("redacts %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "footprint",
    "isNotPaid",
    "slotPosition",
    "hotpink",
    "pivotPoint",
    "tokenizedAmount",
    "company",
    "spin",
    "cardBrand",
    "card_last4",
    "shipping",
    "currency",
  ])("keeps %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("card numbers", () => {
  it("checks the Luhn digit", () => {
    expect(passesLuhn("4242424242424242")).toBe(true);
    expect(passesLuhn("4242424242424241")).toBe(false);
  });

  it("redacts a card number under any key, and counts it", () => {
    const { value, redacted } = redactValue({
      note: "paid with 4242 4242 4242 4242 today",
      number: 4111111111111111,
      createdAt: 1786399200000,
      order: "5105-1051-0510-5100",
      reference: "4242424242424241",
    });
    expect(value).toEqual({
      note: "paid with [REDACTED] today",
      number: "[REDACTED]",
      createdAt: 1786399200000,
      order: "[REDACTED]",
      reference: "4242424242424241",
    });
    expect(redacted).toBe(3);
  });

  it("leaves a long numeric id that no card network issues", () => {
    const ids = ["52345678901234565", "400000000000000002", "2000000000000006"];
    for (const id of ids)
      expect(
        passesLuhn(id),
        "Luhn-valid, but no network issues these prefixes at these lengths.",
      ).toBe(true);
    const { value, redacted } = redactValue({
      orderId: ids[0],
      snowflake: ids[1],
      tracking: `parcel ${ids[2]}`,
    });
    expect(value).toEqual({
      orderId: ids[0],
      snowflake: ids[1],
      tracking: `parcel ${ids[2]}`,
    });
    expect(redacted).toBe(0);
  });

  it("knows the cards of each network", () => {
    for (const card of [
      "4242424242424242",
      "5555555555554444",
      "2223003122003222",
      "378282246310005",
      "6011111111111117",
      "3566002020360505",
      "6200000000000005",
      "36227206271667",
    ]) {
      expect(isCardNumber(card)).toBe(true);
    }
  });

  it("redacts the card data the QA found in clear", () => {
    const { value, redacted } = redactValue({
      cardNumber: "4242 4242 4242 4242",
      card_cvc: "123",
      card: { number: "4242424242424242", cvc: "123" },
      iban: "FR7630006000011234567890189",
      footprint: "carbon-12kg",
    });
    expect(value).toEqual({
      cardNumber: "[REDACTED]",
      card_cvc: "[REDACTED]",
      card: "[REDACTED]",
      iban: "[REDACTED]",
      footprint: "carbon-12kg",
    });
    expect(redacted).toBe(4);
  });
});

describe("redactSearchParams", () => {
  it("counts the redacted parameters", () => {
    const { value, redacted } = redactSearchParams(
      new URLSearchParams("token=a&api_key=b&page=2&page=3"),
    );
    expect(value.toString()).toBe(
      "token=%5BREDACTED%5D&api_key=%5BREDACTED%5D&page=2&page=3",
    );
    expect(redacted).toBe(2);
  });
});

describe("sanitizeBody", () => {
  it("says why a body is not stored", () => {
    expect(sanitizeBody("{nope", "application/json")).toMatchObject({
      omitted: "malformed",
    });
    expect(sanitizeBody("<a/>", "application/xml")).toMatchObject({
      omitted: "not-json",
    });
    expect(sanitizeBody('"a token"', "application/json")).toMatchObject({
      omitted: "not-json",
    });
  });

  it("keeps the answers for the bodies a client sends as text", () => {
    const text = JSON.stringify({
      user: { name: "Jane", password: "x", tags: ["a", 4242424242424242] },
      list: [1, null, true, { token: "t" }],
      note: "paid with 4242 4242 4242 4242",
      nothing: null,
    });
    const expected = {
      text: '{"user":{"name":"Jane","password":"[REDACTED]","tags":["a","[REDACTED]"]},"list":[1,null,true,{"token":"[REDACTED]"}],"note":"paid with [REDACTED]","nothing":null}',
      redacted: 4,
    };
    expect(sanitizeBody(text, "application/json")).toEqual(expected);
    expect(sanitizeBody(Buffer.from(text), "application/json")).toEqual(
      expected,
    );
    expect(sanitizeBody(JSON.parse(text), "application/json")).toEqual(
      expected,
    );
  });

  it("keeps the answers for bodies that are not objects", () => {
    expect(sanitizeBody("null", "application/json")).toEqual({
      omitted: "not-json",
      redacted: 0,
    });
    expect(sanitizeBody(12, "application/json")).toEqual({
      omitted: "not-json",
      redacted: 0,
    });
    expect(sanitizeBody(10n, "application/json")).toEqual({
      omitted: "not-json",
      redacted: 0,
    });
    expect(sanitizeBody(() => 1, "application/json")).toEqual({
      omitted: "not-json",
      redacted: 0,
    });
    expect(sanitizeBody({ big: 10n }, "application/json")).toEqual({
      omitted: "malformed",
      redacted: 0,
    });
  });

  it("cuts a deeply nested body at the redaction depth, however deep it goes", () => {
    const depth = 20_000;
    const nested = "[".repeat(depth) + "]".repeat(depth);
    const { text, redacted } = sanitizeBody(nested, "application/json");
    expect(text).toBe("[".repeat(32) + '"[REDACTED]"' + "]".repeat(32));
    expect(redacted).toBe(1);
  });

  it("redacts a form and counts it", () => {
    expect(
      sanitizeBody(
        "password=x&card=4242424242424242&name=Jane",
        "application/x-www-form-urlencoded",
      ),
    ).toEqual({
      text: "password=%5BREDACTED%5D&card=%5BREDACTED%5D&name=Jane",
      redacted: 2,
    });
  });
});

describe("sanitizeBody on a body set as an object", () => {
  it("stores a Date field the way the client received it", () => {
    expect(sanitizeBody({ at: new Date(0), n: 1 }, "application/json")).toEqual(
      {
        text: '{"at":"1970-01-01T00:00:00.000Z","n":1}',
        redacted: 0,
      },
    );
  });

  it("stores a class instance as its toJSON form, then redacts that form", () => {
    class Session {
      readonly #secret = "kept out of the JSON form";

      get id(): string {
        return this.#secret.slice(0, 4);
      }

      toJSON() {
        return { id: this.id, token: "abc", cards: ["4242424242424242"] };
      }
    }
    expect(
      sanitizeBody({ session: new Session() }, "application/json"),
    ).toEqual({
      text: '{"session":{"id":"kept","token":"[REDACTED]","cards":["[REDACTED]"]}}',
      redacted: 2,
    });
  });

  it("stores a class instance without toJSON by its own enumerable fields", () => {
    class Row {
      id = 7;
      password = "x";
    }
    expect(sanitizeBody([new Row()], "application/json")).toEqual({
      text: '[{"id":7,"password":"[REDACTED]"}]',
      redacted: 1,
    });
  });

  it("omits a body that serialises to a scalar", () => {
    expect(sanitizeBody(new Date(0), "application/json")).toEqual({
      omitted: "not-json",
      redacted: 0,
    });
    expect(
      sanitizeBody({ toJSON: () => undefined }, "application/json"),
    ).toEqual({ omitted: "not-json", redacted: 0 });
  });

  it("stores the fields a client received, and none that JSON drops", () => {
    expect(
      sanitizeBody(
        { password: undefined, tag: () => 1, n: 1, list: [undefined] },
        "application/json",
      ),
    ).toEqual({ text: '{"n":1,"list":[null]}', redacted: 0 });
  });

  it("omits a circular body as malformed, as it is for any body JSON cannot hold", () => {
    interface Loop {
      id: number;
      self?: Loop;
    }
    const body: Loop = { id: 1 };
    body.self = body;
    expect(sanitizeBody(body, "application/json")).toEqual({
      omitted: "malformed",
      redacted: 0,
    });
  });
});
