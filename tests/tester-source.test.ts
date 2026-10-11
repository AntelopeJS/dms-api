import { describe, expect, it } from "vitest";
import { setConfig } from "@/config";
import { pickHeaders } from "@/services/request-log/util";
import {
  isTesterSourceToken,
  issueTesterSourceToken,
  requestSource,
  TESTER_SOURCE_TOKEN_TTL_MS,
} from "@/services/tester-source";

const NOW = new Date("2026-10-11T12:00:00Z");
const HEADER = "x-antelopejs-api-source";

describe("Tester source token", () => {
  it("marks a call carrying a token the server issued", () => {
    const token = issueTesterSourceToken(NOW);
    expect(token.header).toBe(HEADER);
    expect(requestSource({ [HEADER]: token.value }, NOW)).toBe("tester");
  });

  it("does not let a client declare itself the Tester", () => {
    expect(requestSource({ [HEADER]: "tester" }, NOW)).toBeUndefined();
    expect(
      requestSource({ "x-dms-api-source": "tester" }, NOW),
    ).toBeUndefined();
    expect(requestSource({}, NOW)).toBeUndefined();
  });

  it("refuses a forged or tampered token", () => {
    const { value } = issueTesterSourceToken(NOW);
    const [prefix, expiry, signature] = value.split(".");
    const later = String(Number(expiry) + 1000);
    expect(isTesterSourceToken(`${prefix}.${later}.${signature}`, NOW)).toBe(
      false,
    );
    expect(isTesterSourceToken(`${prefix}.${expiry}.AAAA`, NOW)).toBe(false);
    expect(isTesterSourceToken(`${prefix}.${expiry}`, NOW)).toBe(false);
  });

  it("refuses an expired token", () => {
    const { value } = issueTesterSourceToken(NOW);
    const expired = new Date(NOW.getTime() + TESTER_SOURCE_TOKEN_TTL_MS + 1);
    expect(isTesterSourceToken(value, expired)).toBe(false);
  });

  it("refuses a token signed with another key", () => {
    setConfig({ testerSourceSecret: "one" });
    const { value } = issueTesterSourceToken(NOW);
    setConfig({ testerSourceSecret: "two" });
    expect(isTesterSourceToken(value, NOW)).toBe(false);
    setConfig({ testerSourceSecret: "one" });
    expect(isTesterSourceToken(value, NOW)).toBe(true);
    setConfig();
  });

  it("is never stored with the captured headers", () => {
    const dropped: string[] = [];
    const { value } = issueTesterSourceToken(NOW);
    expect(
      pickHeaders(
        { [HEADER]: value, accept: "*/*" },
        [HEADER, "accept"],
        dropped,
      ),
    ).toEqual({ accept: "*/*" });
    expect(dropped).toEqual([HEADER]);
  });
});
