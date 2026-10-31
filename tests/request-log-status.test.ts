import { describe, expect, it } from "vitest";
import { extractStatusCode } from "@/services/request-log/util";

describe("extractStatusCode", () => {
  it("reads the status of an HTTPResult-like value", () => {
    expect(extractStatusCode({ getStatus: () => 404 })).toBe(404);
  });

  it("falls through to statusCode, then status, then 200", () => {
    expect(extractStatusCode({ statusCode: 502 })).toBe(502);
    expect(extractStatusCode({ status: 503 })).toBe(503);
    expect(extractStatusCode({})).toBe(200);
  });

  it("falls through when getStatus throws", () => {
    const thrower = {
      getStatus: () => {
        throw new Error("no status");
      },
      statusCode: 500,
    };
    expect(extractStatusCode(thrower)).toBe(500);
  });

  it("falls through when getStatus does not return a number", () => {
    expect(extractStatusCode({ getStatus: () => "404", statusCode: 503 })).toBe(
      503,
    );
    expect(extractStatusCode({ getStatus: () => undefined })).toBe(200);
  });
});
