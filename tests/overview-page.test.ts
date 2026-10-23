import { describe, expect, it } from "vitest";
import { GetMetadata } from "@antelopejs/interface-core";
import { PageMetadata } from "@antelopejs/interface-dms/page";
import { OverviewPage } from "@/pages/overview";

interface Serialized {
  componentName: string;
  options?: Record<string, unknown> & {
    watchActions?: { event: string; functionId: string }[];
    realtimeTopic?: unknown;
  };
  children?: { id: string; slot?: string; component: Serialized }[];
}

function child(parent: Serialized, id: string): Serialized {
  const found = parent.children?.find((entry) => entry.id === id);
  if (!found) throw new Error(`no child ${id}`);
  return found.component;
}

describe("OverviewPage", () => {
  const toolbar = OverviewPage.toolbar.serializeSync() as Serialized;
  const dashboard = OverviewPage.dashboard.serializeSync() as Serialized;

  it("holds the toolbar of the monitoring pages, with the Beta badge", () => {
    expect(toolbar.componentName).toBe("dms-page-toolbar-block");
    expect(
      toolbar.children?.map((entry) => [
        entry.id,
        entry.component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["beta", "DmsApiBetaBadge"],
      ["live", "dms-live-toggle-block"],
      ["period", "dms-period-selector"],
    ]);
  });

  it("keeps its period in the URL with the DMS selector, against the one before", () => {
    expect(child(toolbar, "period").options).toMatchObject({
      id: "api",
      variant: "segmented",
      presets: ["last-hour", "last-24h", "last-7-days", "last-30-days"],
      defaultPreset: "last-24h",
      comparisons: ["previous-period", "none"],
      defaultComparison: "previous-period",
      comparisonControl: "menu",
    });
  });

  it("leads with the health hero, read from the overview's health route", () => {
    const health = OverviewPage.health.serializeSync() as Serialized;
    expect(health.componentName).toBe("DmsApiHealthHero");
    expect(health.options).toMatchObject({
      fetchUrl: "/api/monitoring/overview/health",
    });
  });

  it("lists what needs a look and the top routes with DMS blocks", () => {
    const row = child(dashboard, "health");
    expect(child(row, "attention").componentName).toMatch(/activity-feed/);
    expect(child(row, "slowest").componentName).toMatch(/top-list/);
    expect(child(child(dashboard, "traffic"), "classes").componentName).toMatch(
      /top-list/,
    );
  });

  it("writes the slowest routes in ms and dates the routes to check", () => {
    const row = child(dashboard, "health");
    expect(child(row, "slowest").options).toMatchObject({
      valueFormat: "number",
      valueSuffix: " ms",
    });
    expect(child(row, "attention").options).toMatchObject({
      badge: "$api.overview.attention.badge",
    });
  });

  it("follows the live feed, which the page's Direct / Pause holds", () => {
    const info = GetMetadata(OverviewPage, PageMetadata).pageInfo as {
      live?: unknown;
    };
    // One Direct / Pause choice for the module's pages, slower over a week.
    expect(info.live).toEqual({
      maxRate: 10,
      slowRateAfter: { period: "7d", maxRate: 60 },
      rememberKey: "api",
    });
    for (const [row, id] of [
      ["health", "attention"],
      ["recent", "activity"],
    ] as const) {
      const block = child(child(dashboard, row), id);
      expect(block.options?.realtimeTopic).toBe("api:monitor:requests");
    }
    const table = child(child(child(dashboard, "recent"), "requests"), "table");
    expect(table.options).toMatchObject({
      realtimeTopic: "api:monitor:requests",
      liveHold: { whileRowOpen: true },
    });
  });
});
