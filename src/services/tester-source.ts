import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { getConfig } from "@/config";
import type { RequestLogSource } from "@/db/tables/request_log.table";
import { MS_PER_MINUTE, TESTER_SOURCE_HEADER } from "@/types/constants";

/**
 * How the capture tells the Tester's and the automation procedures' calls
 * apart. A request has a source only when its {@link TESTER_SOURCE_HEADER}
 * holds a token this server signed, for the Tester or for a procedure's
 * `api.call-route`: a client cannot declare itself either to keep its calls
 * out of the statistics and the health.
 *
 * The token is `<source>.<expiry ms>.<HMAC-SHA256 of the first two parts>`,
 * signed with `testerSourceSecret` (shared by every instance of the API) or,
 * unset, with a key drawn at start. It holds no identity: it only says "the
 * console's Tester sent this", or "a procedure sent this", until it expires.
 */
const SOURCES: readonly RequestLogSource[] = ["tester", "automation"];
const TOKEN_SEPARATOR = ".";

/** How long a token is accepted. The Tester asks for one before each call. */
export const TESTER_SOURCE_TOKEN_TTL_MS = 15 * MS_PER_MINUTE;

/** Signs the tokens when no `testerSourceSecret` is configured. */
const startKey = randomBytes(32);

function signingKey(): Buffer | string {
  return getConfig().testerSourceSecret || startKey;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", signingKey()).update(payload).digest();
}

/** What the Tester sends the next calls with. */
export interface TesterSourceToken {
  header: string;
  value: string;
  expiresAt: string;
}

/** A token marking the next calls as sent by `source`. */
export function issueSourceToken(
  source: RequestLogSource,
  now: Date = new Date(),
): TesterSourceToken {
  const expiresAt = now.getTime() + TESTER_SOURCE_TOKEN_TTL_MS;
  const payload = `${source}${TOKEN_SEPARATOR}${expiresAt}`;
  return {
    header: TESTER_SOURCE_HEADER,
    value: `${payload}${TOKEN_SEPARATOR}${signature(payload).toString("base64url")}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function issueTesterSourceToken(
  now: Date = new Date(),
): TesterSourceToken {
  return issueSourceToken("tester", now);
}

/** The source a token this server signed names, while it has not expired. */
export function sourceOfToken(
  value: string,
  now: Date = new Date(),
): RequestLogSource | undefined {
  const parts = value.split(TOKEN_SEPARATOR);
  if (parts.length !== 3) return undefined;
  const source = SOURCES.find((name) => name === parts[0]);
  if (!source) return undefined;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt)) return undefined;
  const left = expiresAt - now.getTime();
  if (left <= 0 || left > TESTER_SOURCE_TOKEN_TTL_MS) return undefined;
  const given = Buffer.from(parts[2], "base64url");
  const expected = signature(`${parts[0]}${TOKEN_SEPARATOR}${parts[1]}`);
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? source
    : undefined;
}

/** Whether `value` is a Tester token this server signed and that has not expired. */
export function isTesterSourceToken(
  value: string,
  now: Date = new Date(),
): boolean {
  return sourceOfToken(value, now) === "tester";
}

/** `tester` or `automation` when the request carries a valid token of either. */
export function requestSource(
  headers: IncomingHttpHeaders,
  now: Date = new Date(),
): RequestLogSource | undefined {
  const raw = headers[TESTER_SOURCE_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? sourceOfToken(value, now) : undefined;
}
