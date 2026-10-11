import { TESTER_SOURCE_HEADER } from "@/types/constants";

const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 32;

/**
 * How a word of the list is looked for in a key, once the key is split into
 * lower-cased words on case changes, digits and separators (`cardNumber`,
 * `X-Api-Key`, `card_cvc2`):
 *  - `anywhere`: in the key with its separators removed (`clientSecret`,
 *    `x-api-key`);
 *  - `suffix`: as a word or the end of one (`accessToken`, `accesstoken`,
 *    `totp`);
 *  - `word`: as a whole word only (`userPin`, not `spin`);
 *  - `last`: as the key's last word (`creditCard`, not `cardBrand`).
 *
 * Short words go by words: looked for anywhere, `otp` would hide `footprint`
 * and `isNotPaid`, and `pan` would hide `company`.
 */
type KeyMatch = "anywhere" | "suffix" | "word" | "last";

const KEY_RULES: ReadonlyArray<readonly [string, KeyMatch]> = [
  ["password", "anywhere"],
  ["passwd", "anywhere"],
  ["secret", "anywhere"],
  ["authorization", "anywhere"],
  ["cookie", "anywhere"],
  ["apikey", "anywhere"],
  ["privatekey", "anywhere"],
  ["credential", "anywhere"],
  ["recoverycode", "anywhere"],
  ["backupcode", "anywhere"],
  ["cardnumber", "anywhere"],
  ["securitycode", "anywhere"],
  ["pincode", "anywhere"],
  ["token", "suffix"],
  ["otp", "suffix"],
  ["cvc", "suffix"],
  ["cvv", "suffix"],
  ["cvn", "suffix"],
  ["iban", "suffix"],
  ["pin", "word"],
  ["pan", "word"],
  ["ssn", "word"],
  ["card", "last"],
];

/**
 * Words a key is redacted for (see {@link KeyMatch} for how each is looked
 * for). Listed on the Settings page, read-only. Values are also redacted
 * whatever their key when they read as a payment card number.
 */
export const REDACTED_KEY_WORDS: readonly string[] = KEY_RULES.map(
  ([word]) => word,
);

/** `X-Api-Key` → `x api key`; `cardCVC2` → `card cvc 2`; `APIKey` → `api key`. */
function keyWords(key: string): string[] {
  return (
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z]+|[0-9]+/g) ?? []
  );
}

/** Identifies credential-bearing keys independently of case and separators. */
export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  const joined = words.join("");
  return KEY_RULES.some(([word, match]) => {
    switch (match) {
      case "anywhere":
        return joined.includes(word);
      case "suffix":
        return words.some((each) => each.endsWith(word));
      case "word":
        return words.includes(word);
      case "last":
        return words.at(-1) === word;
    }
  });
}

/**
 * Headers never stored: the ones named like a credential, and the Tester's
 * token, which would let a reader of the logs pass for the Tester.
 */
export function isSensitiveHeader(name: string): boolean {
  return name.toLowerCase() === TESTER_SOURCE_HEADER || isSensitiveKey(name);
}

/**
 * A run of 13 to 19 digits, spaces or dashes allowed between them, starting
 * like a card network does (2 to 6): Mastercard, Visa, Amex, Discover, JCB,
 * UnionPay. Epoch timestamps in milliseconds (13 digits starting with 1) and
 * phone numbers stay out of it.
 */
const CARD_NUMBER = /(?<![0-9])[2-6](?:[ -]?[0-9]){12,18}(?![0-9])/g;

/** The Luhn checksum every payment card number carries. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Counts what one redaction pass replaced. */
class Redactor {
  count = 0;

  /** `text` with every card number in it replaced. */
  text(text: string): string {
    return text.replace(CARD_NUMBER, (match) => {
      if (!passesLuhn(match.replace(/[ -]/g, ""))) return match;
      this.count++;
      return REDACTED;
    });
  }

  value(value: unknown, depth = 0): unknown {
    if (depth >= MAX_REDACTION_DEPTH) {
      this.count++;
      return REDACTED;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.value(item, depth + 1));
    }
    if (typeof value === "string") return this.text(value);
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      const redacted = this.text(String(value));
      return redacted === REDACTED ? redacted : value;
    }
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (!isSensitiveKey(key)) return [key, this.value(item, depth + 1)];
        this.count++;
        return [key, REDACTED];
      }),
    );
  }

  params(params: URLSearchParams): URLSearchParams {
    return new URLSearchParams(
      [...params].map(([key, value]) => {
        if (!isSensitiveKey(key)) return [key, this.text(value)];
        this.count++;
        return [key, REDACTED];
      }),
    );
  }
}

/** A redacted copy, and the number of values the redaction replaced. */
export interface Redacted<T> {
  value: T;
  redacted: number;
}

function redactWith<T>(redact: (redactor: Redactor) => T): Redacted<T> {
  const redactor = new Redactor();
  const value = redact(redactor);
  return { value, redacted: redactor.count };
}

/**
 * Copies structured data without retaining values under credential keys, nor
 * card numbers under any key.
 */
export function redactValue(value: unknown): Redacted<unknown> {
  return redactWith((redactor) => redactor.value(value));
}

/** Redacts query parameters while retaining repeated non-sensitive values. */
export function redactSearchParams(
  params: URLSearchParams,
): Redacted<URLSearchParams> {
  return redactWith((redactor) => redactor.params(params));
}

/** A body as stored, or why it is not. */
export interface SanitizedBody {
  text?: string;
  omitted?: "not-json" | "malformed";
  redacted: number;
}

/** Omits unstructured or malformed bodies that cannot be safely key-redacted. */
export function sanitizeBody(
  body: unknown,
  contentType: string,
): SanitizedBody {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  const isForm = mediaType === "application/x-www-form-urlencoded";
  if (
    !isForm &&
    mediaType !== "application/json" &&
    !mediaType.endsWith("+json")
  ) {
    return { omitted: "not-json", redacted: 0 };
  }
  try {
    if (isForm) {
      if (typeof text !== "string")
        return { omitted: "malformed", redacted: 0 };
      const { value, redacted } = redactSearchParams(new URLSearchParams(text));
      return { text: value.toString(), redacted };
    }
    const parsed: unknown = typeof text === "string" ? JSON.parse(text) : text;
    // A JSON scalar has no key to redact by: a bare string may be a token.
    if (parsed === null || typeof parsed !== "object") {
      return { omitted: "not-json", redacted: 0 };
    }
    const { value, redacted } = redactValue(parsed);
    return { text: JSON.stringify(value), redacted };
  } catch {
    return { omitted: "malformed", redacted: 0 };
  }
}

/** `"key": <string, number or literal>` in JSON text, for cut-off bodies. */
const JSON_MEMBER =
  /"((?:[^"\\]|\\.)*)"(\s*:\s*)("(?:[^"\\]|\\.)*"?|-?[0-9][0-9.eE+-]*|true|false|null)/g;

/**
 * Redacts a body as an earlier capture stored it, by today's rules: JSON is
 * redacted as structured data, a form as parameters. A JSON body cut at the
 * size limit no longer parses: its members are redacted one by one in the
 * text, and card numbers wherever they are.
 */
export function redactStoredBody(text: string): Redacted<string> {
  return redactWith((redactor) => {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return redactor.params(new URLSearchParams(text)).toString();
    }
    try {
      return JSON.stringify(redactor.value(JSON.parse(text)));
    } catch {
      const members = text.replace(
        JSON_MEMBER,
        (member, key: string, colon: string, value: string) => {
          if (!isSensitiveKey(key) || value === `"${REDACTED}"`) return member;
          redactor.count++;
          return `"${key}"${colon}"${REDACTED}"`;
        },
      );
      return redactor.text(members);
    }
  });
}
