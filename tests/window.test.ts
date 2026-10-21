import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "@/config";
import {
  bucketOf,
  bucketStarts,
  CACHE_QUANTUM_MS,
  resolveWindow,
} from "@/services/window";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "@/types";

const NOW = new Date("2026-10-07T15:00:02.000Z");
const PINNED = new Date("2026-10-07T15:00:00.000Z");

afterEach(() => setConfig());

describe("resolveWindow", () => {
  it("rolls a preset back from now, pinned to the cache step", () => {
    const window = resolveWindow({ preset: "last-24h" }, "last-7-days", NOW);
    expect(window.preset).toBe("last-24h");
    expect(window.to).toEqual(PINNED);
    expect(window.to.getTime() - window.from.getTime()).toBe(MS_PER_DAY);
    expect(window.granularity).toBe("hour");
    expect(PINNED.getTime() % CACHE_QUANTUM_MS).toBe(0);
  });

  it("reads a preset as rolling up to now, not as its calendar range", () => {
    const window = resolveWindow(
      {
        preset: "last-7-days",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-07T23:59:59.999Z",
      },
      "last-24h",
      NOW,
    );
    expect(window.preset).toBe("last-7-days");
    expect(window.to).toEqual(PINNED);
    expect(window.to.getTime() - window.from.getTime()).toBe(7 * MS_PER_DAY);
    expect(window.granularity).toBe("day");
  });

  it("falls back to its default preset and buckets an hour by the minute", () => {
    expect(resolveWindow({}, "last-7-days", NOW).preset).toBe("last-7-days");
    expect(
      resolveWindow({ preset: "last-hour" }, "last-7-days", NOW).granularity,
    ).toBe("minute");
  });

  it("compares to the period right before, of the same length", () => {
    const window = resolveWindow({ preset: "last-7-days" }, "last-7-days", NOW);
    expect(window.previous).toEqual({
      from: new Date(window.from.getTime() - 7 * MS_PER_DAY),
      to: window.from,
    });
    expect(window.previousAvailable).toBe(true);
  });

  it("takes a custom comparison as given", () => {
    const window = resolveWindow(
      {
        from: "2026-10-06T15:00:00.000Z",
        to: "2026-10-07T15:00:00.000Z",
        comparison: "custom",
        compareFrom: "2026-09-29T15:00:00.000Z",
        compareTo: "2026-09-30T15:00:00.000Z",
      },
      "last-7-days",
      NOW,
    );
    expect(window.preset).toBeNull();
    expect(window.previous?.from).toEqual(new Date("2026-09-29T15:00:00.000Z"));
  });

  it("leaves the comparison out when the selector asks for none", () => {
    const window = resolveWindow({ comparison: "none" }, "last-7-days", NOW);
    expect(window.previous).toBeNull();
  });

  it("says when the period before 30 days is no longer kept", () => {
    setConfig({ statisticsLifetime: 30 * MS_PER_DAY });
    const short = resolveWindow({ preset: "last-30-days" }, "last-7-days", NOW);
    expect(short.previousAvailable).toBe(false);
    expect(short.previous).toBeNull();
    setConfig({ statisticsLifetime: 60 * MS_PER_DAY });
    expect(
      resolveWindow({ preset: "last-30-days" }, "last-7-days", NOW)
        .previousAvailable,
    ).toBe(true);
  });

  it("puts a reversed range back in order and ignores garbage", () => {
    const reversed = resolveWindow(
      { from: NOW.toISOString(), to: "2026-10-01T00:00:00.000Z" },
      "last-7-days",
      NOW,
    );
    expect(reversed.from < reversed.to).toBe(true);
    const garbage = resolveWindow({ preset: "soon" }, "last-24h", NOW);
    expect(garbage.preset).toBe("last-24h");
  });

  it("never reaches further back than the statistics are kept", () => {
    setConfig({ statisticsLifetime: 30 * MS_PER_DAY });
    const window = resolveWindow(
      { from: "2020-01-01T00:00:00.000Z" },
      "last-7-days",
      NOW,
    );
    expect(NOW.getTime() - window.from.getTime()).toBeLessThanOrEqual(
      31 * MS_PER_DAY,
    );
  });
});

describe("buckets", () => {
  it("covers [from, to) with one start per hour, none at `to`", () => {
    const aligned = bucketStarts(
      { from: new Date(PINNED.getTime() - 3 * MS_PER_HOUR), to: PINNED },
      "hour",
    );
    expect(aligned).toHaveLength(3);
    expect(aligned[1] - aligned[0]).toBe(MS_PER_HOUR);
    const offset = bucketStarts(
      {
        from: new Date(PINNED.getTime() - 3 * MS_PER_HOUR - 30 * MS_PER_MINUTE),
        to: PINNED,
      },
      "hour",
    );
    expect(offset).toHaveLength(4);
  });

  it("does not start a day bucket at the end of a day window", () => {
    const midnight = new Date(2026, 9, 7);
    const starts = bucketStarts(
      { from: new Date(2026, 9, 4), to: midnight },
      "day",
    );
    expect(starts).toHaveLength(3);
    expect(starts).not.toContain(midnight.getTime());
  });

  it("files a timestamp under the start of its bucket", () => {
    expect(bucketOf(PINNED.getTime() + 25 * MS_PER_MINUTE, "hour")).toBe(
      bucketOf(PINNED.getTime(), "hour"),
    );
    expect(bucketOf(PINNED.getTime() + 59_000, "minute")).toBe(
      PINNED.getTime(),
    );
  });
});
