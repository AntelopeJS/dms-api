import { describe, expect, it } from "vitest";
import { inferredTypeOf } from "@/services/introspection";

describe("inferredTypeOf", () => {
  it("maps the classes a parameter can declare", () => {
    expect(inferredTypeOf("Number", "param")).toBe("number");
    expect(inferredTypeOf("Boolean", "param")).toBe("boolean");
    expect(inferredTypeOf("Buffer", "param")).toBe("buffer");
    expect(inferredTypeOf("Object", "param")).toBe("object");
  });

  it("reads a string for a missing or unknown class", () => {
    expect(inferredTypeOf(null, "param")).toBe("string");
    expect(inferredTypeOf("Date", "param")).toBe("string");
  });

  it("reads a string for a query parameter, whose value is text or a bare flag", () => {
    expect(inferredTypeOf("Object", "query")).toBe("string");
    expect(inferredTypeOf("String", "query")).toBe("string");
  });

  it("reads a string for a class named like an Object member", () => {
    for (const name of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(inferredTypeOf(name, "param")).toBe("string");
    }
  });
});
