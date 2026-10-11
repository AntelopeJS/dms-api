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
    // Luhn-valid, but no network issues these prefixes at these lengths.
    const ids = ["52345678901234565", "400000000000000002", "2000000000000006"];
    for (const id of ids) expect(passesLuhn(id)).toBe(true);
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
