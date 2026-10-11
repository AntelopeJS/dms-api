import { describe, expect, it } from "vitest";
import { OverviewPage } from "@/pages/overview";
import { blockClientId } from "@/pages/live";

interface Serialized {
  componentName: string;
  options?: Record<string, unknown> & {
    watchActions?: { event: string; functionId: string }[];
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

  it("holds the toolbar of the monitoring pages: scope, Beta, live, period", () => {
    expect(toolbar.componentName).toBe("DmsApiPageToolbar");
    expect(
      toolbar.children?.map((entry) => [
        entry.id,
        entry.slot,
        entry.component.componentName,
      ]),
    ).toEqual([
      ["scope", "scope", "DmsApiScopeChip"],
      ["beta", "badge", "DmsApiBetaBadge"],
      ["live", "live", "DmsApiLiveControl"],
      ["period", "period", "DmsApiPeriodWindow"],
    ]);
  });

  it("keeps the charts and the activity live while Recent requests holds", () => {
    const live = child(toolbar, "live").options as { liveBlocks: string[] };
    const dashboard = OverviewPage.dashboard.serializeSync() as Serialized;
    const watched = [
      ["health", "errorShare"],
      ["traffic", "chart"],
      ["recent", "activity"],
    ];
    expect(live.liveBlocks).toEqual(
      watched.map((path) => blockClientId("dashboard", ...path)),
    );
    for (const [row, id] of watched) {
      const block = child(child(dashboard, row), id);
      expect(block.options?.watchActions).toEqual([
        expect.objectContaining({
          event: "dms-api:live-blocks",
          functionId: "dms-api:live-blocks",
        }),
      ]);
    }
    // The table itself follows no such event: it holds.
    const table = child(child(child(dashboard, "recent"), "requests"), "table");
    expect(table.options?.watchActions).toBeUndefined();
  });

  it("names a block by the id the DMS renderer gives it", () => {
    expect(blockClientId("dashboard", "traffic", "chart")).toBe(
      "dashboard-child-traffic-child-chart",
    );
  });

  it("reads the health while paused, to tell a changed verdict", () => {
    expect(child(toolbar, "live").options).toMatchObject({
      page: "overview",
      healthUrl: "/api/monitoring/overview/health",
    });
  });
});
