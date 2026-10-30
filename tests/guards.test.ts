import { describe, expect, it } from "vitest";
import { isJsonValue } from "@/guards";

class Row {
  readonly id = 1;
}

describe("isJsonValue", () => {
  it("accepts what JSON.parse returns", () => {
    const parsed: unknown = JSON.parse(
      '{"a":[1,"b",null,true],"c":{"d":{}},"__proto__":{"e":1}}',
    );

    expect(isJsonValue(parsed)).toBe(true);
  });

  it("rejects objects that are not plain, at any depth", () => {
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(new Map())).toBe(false);
    expect(isJsonValue(new Row())).toBe(false);
    expect(isJsonValue({ nested: [new Row()] })).toBe(false);
  });

  it("accepts an object without a prototype", () => {
    expect(isJsonValue(Object.assign(Object.create(null), { a: 1 }))).toBe(
      true,
    );
  });

  it("rejects values JSON cannot hold", () => {
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue({ a: undefined })).toBe(false);
  });
});
