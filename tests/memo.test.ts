import { describe, expect, it } from "vitest";
import { createMemoPool } from "@/memo";

const HOUR_MS = 60 * 60 * 1000;

function counter() {
  let calls = 0;
  return {
    load: (value: string) => () => {
      calls += 1;
      return Promise.resolve(value);
    },
    calls: () => calls,
  };
}

describe("createMemoPool", () => {
  it("evicts the oldest value of any memo once the shared bound is reached", async () => {
    const pool = createMemoPool(2, HOUR_MS);
    const words = pool.memo<string>();
    const counts = pool.memo<number>();
    const loads = counter();
    await words.cached("a", loads.load("a"));
    await counts.cached("one", () => Promise.resolve(1));
    await counts.cached("two", () => Promise.resolve(2));

    await words.cached("a", loads.load("a again"));

    expect(loads.calls()).toBe(2);
  });

  it("keeps a value while the shared bound has room", async () => {
    const pool = createMemoPool(3, HOUR_MS);
    const words = pool.memo<string>();
    const counts = pool.memo<number>();
    await words.cached("a", () => Promise.resolve("first"));
    await counts.cached("one", () => Promise.resolve(1));

    const value = await words.cached("a", () => Promise.resolve("second"));

    expect(value).toBe("first");
  });

  it("retries a key whose load failed", async () => {
    const memo = createMemoPool(4, HOUR_MS).memo<string>();
    await expect(
      memo.cached("a", () => Promise.reject(new Error("down"))),
    ).rejects.toThrow("down");

    const value = await memo.cached("a", () => Promise.resolve("up"));

    expect(value).toBe("up");
  });

  it("clears every memo of the pool at once", async () => {
    const pool = createMemoPool(4, HOUR_MS);
    const words = pool.memo<string>();
    await words.cached("a", () => Promise.resolve("first"));

    pool.clear();

    expect(await words.cached("a", () => Promise.resolve("second"))).toBe(
      "second",
    );
  });
});
