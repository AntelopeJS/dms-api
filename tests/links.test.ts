import { describe, expect, it } from "vitest";
import { logsLink } from "@/services/links";

function query(link: string) {
  return new URL(link, "http://console.local").searchParams;
}

describe("logsLink", () => {
  it("opens a narrowing link on the All tab, which the table mounts on", () => {
    expect(query(logsLink({ route: "GET /a" })).get("requests.tab")).toBe(
      "all",
    );
    expect(query(logsLink({ path: "/a/1" })).get("requests.tab")).toBe("all");
    expect(
      query(
        logsLink({ range: { from: new Date(0), to: new Date(60_000) } }),
      ).get("requests.tab"),
    ).toBe("all");
  });

  it("keeps the tab a link names, and names none for the whole log", () => {
    expect(
      query(logsLink({ route: "GET /a", tab: "5xx" })).get("requests.tab"),
    ).toBe("5xx");
    expect(query(logsLink({ period: "last-24h" })).has("requests.tab")).toBe(
      false,
    );
    expect(logsLink()).toBe("/modules/api/logs");
  });

  it("carries the period for the page's period selector", () => {
    expect(query(logsLink({ period: "last-7-days" })).get("api.period")).toBe(
      "last-7-days",
    );
  });

  it("writes a range in the selector's own keys, in place of a preset", () => {
    const link = query(
      logsLink({
        period: "last-24h",
        range: { from: new Date(0), to: new Date(60_000) },
      }),
    );
    expect(link.get("api.from")).toBe("1970-01-01T00:00:00.000Z");
    expect(link.get("api.to")).toBe("1970-01-01T00:01:00.000Z");
    expect(link.has("api.period")).toBe(false);
  });
});
