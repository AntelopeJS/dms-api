import { describe, expect, it } from "vitest";
import { logsLink, overviewLink, requestLink } from "@/services/links";

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

  it("writes a range as a linked filter, the period kept", () => {
    const link = query(
      logsLink({
        period: "last-24h",
        range: { from: new Date(0), to: new Date(60_000) },
      }),
    );
    expect(link.get("since")).toBe("1970-01-01T00:00:00.000Z");
    expect(link.get("until")).toBe("1970-01-01T00:01:00.000Z");
    expect(link.get("api.period")).toBe("last-24h");
  });
});

describe("the links the automation nodes hand on", () => {
  it("opens a request in the logs' drawer by its log id", () => {
    expect(requestLink("a b")).toBe("/modules/api/logs?record=a+b");
  });

  it("finds a call by its request id on the All tab", () => {
    const link = query(logsLink({ requestId: "auto-1" }));
    expect(link.get("requestId")).toBe("auto-1");
    expect(link.get("requests.tab")).toBe("all");
  });

  it("writes an open-ended range with its one bound", () => {
    const link = query(logsLink({ range: { from: new Date(0) } }));
    expect(link.get("since")).toBe("1970-01-01T00:00:00.000Z");
    expect(link.has("until")).toBe(false);
  });

  it("opens the Overview on a period", () => {
    expect(overviewLink("last-hour")).toBe(
      "/modules/api/overview?api.period=last-hour",
    );
    expect(overviewLink()).toBe("/modules/api/overview");
  });
});
