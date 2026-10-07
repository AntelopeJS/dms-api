import { describe, expect, it } from "vitest";
import { bodyErrorMessage } from "@/services/request-log/capture";

describe("bodyErrorMessage", () => {
  it("reads `error` or `message` from a body object or its JSON", () => {
    expect(bodyErrorMessage({ error: "Cart is empty" })).toBe("Cart is empty");
    expect(bodyErrorMessage('{"message":" Not found "}')).toBe("Not found");
    expect(bodyErrorMessage(Buffer.from('{"error":"Conflict"}'))).toBe(
      "Conflict",
    );
  });

  it("finds nothing in a body without one", () => {
    expect(bodyErrorMessage({ id: 1 })).toBeUndefined();
    expect(bodyErrorMessage("<html>")).toBeUndefined();
    expect(bodyErrorMessage(undefined)).toBeUndefined();
  });
});
