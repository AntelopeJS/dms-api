import { describe, expect, it } from "vitest";
import { inferredTypeOf } from "@/services/introspection";

describe("inferredTypeOf", () => {
  it("maps the classes a parameter can declare", () => {
    expect(inferredTypeOf("Number")).toBe("number");
    expect(inferredTypeOf("Boolean")).toBe("boolean");
    expect(inferredTypeOf("Buffer")).toBe("buffer");
    expect(inferredTypeOf("Object")).toBe("object");
  });

  it("reads a string for a missing or unknown class", () => {
    expect(inferredTypeOf(null)).toBe("string");
    expect(inferredTypeOf("Date")).toBe("string");
  });

  it("reads a string for a class named like an Object member", () => {
    for (const name of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(inferredTypeOf(name)).toBe("string");
    }
  });
});
