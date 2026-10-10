import { describe, expect, it } from "vitest";
import { bucketOf, bucketStarts, resolveWindow } from "@/services/window";
import { MS_PER_DAY, MS_PER_HOUR } from "@/types";

const NOW = new Date("2026-10-07T15:00:00.000Z");

describe("resolveWindow", () => {
  it("falls back to the last N days, by day, against the period before", () => {
    const window = resolveWindow({}, 7, NOW);
    expect(window.granularity).toBe("day");
    expect(window.to).toEqual(NOW);
    expect(window.to.getTime() - window.from.getTime()).toBe(7 * MS_PER_DAY);
    expect(window.previous).toEqual({
      from: new Date(window.from.getTime() - 7 * MS_PER_DAY),
      to: window.from,
    });
  });

  it("reads hour buckets for a window of two days or less", () => {
    const window = resolveWindow(
      { from: "2026-10-06T15:00:00.000Z", to: NOW.toISOString() },
      7,
      NOW,
    );
    expect(window.granularity).toBe("hour");
  });

  it("leaves the comparison out when the selector asks for none", () => {
    expect(resolveWindow({ comparison: "none" }, 7, NOW).previous).toBeNull();
  });

  it("puts a reversed range back in order and ignores garbage", () => {
    const reversed = resolveWindow(
      { from: NOW.toISOString(), to: "2026-10-01T00:00:00.000Z" },
      7,
      NOW,
    );
    expect(reversed.from < reversed.to).toBe(true);
    const garbage = resolveWindow({ from: "yesterday", to: "soon" }, 3, NOW);
    expect(garbage.to.getTime() - garbage.from.getTime()).toBe(3 * MS_PER_DAY);
  });

  it("never reaches further back than the statistics are kept", () => {
    const window = resolveWindow({ from: "2020-01-01T00:00:00.000Z" }, 7, NOW);
    expect(NOW.getTime() - window.from.getTime()).toBeLessThanOrEqual(
      30 * MS_PER_DAY,
    );
  });
});

describe("buckets", () => {
  it("covers a window with one start per hour", () => {
    const starts = bucketStarts(
      { from: new Date(NOW.getTime() - 3 * MS_PER_HOUR), to: NOW },
      "hour",
    );
    expect(starts).toHaveLength(4);
    expect(starts[1] - starts[0]).toBe(MS_PER_HOUR);
  });

  it("files a timestamp under the start of its bucket", () => {
    const start = bucketOf(NOW.getTime() + 25 * 60_000, "hour");
    expect(start).toBe(bucketOf(NOW.getTime(), "hour"));
  });
});
