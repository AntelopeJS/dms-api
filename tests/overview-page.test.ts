import { describe, expect, it } from "vitest";
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

  it("holds the toolbar of the monitoring pages: scope, live, period", () => {
    expect(toolbar.componentName).toBe("dms-h-stack");
    expect(
      toolbar.children?.map((entry) => [
        entry.id,
        entry.component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["spacer", expect.stringMatching(/spacer/)],
      ["live", "DmsApiLiveControl"],
      ["period", "DmsApiPeriodWindow"],
    ]);
  });

  it("draws the health with DMS blocks read from the overview routes", () => {
    const health = OverviewPage.health.serializeSync() as Serialized;
    const figures = OverviewPage.figures.serializeSync() as Serialized;
    expect(health.componentName).toMatch(/banner/);
    expect(health.options).toMatchObject({
      fetchUrl: "/api/monitoring/overview/health",
    });
    expect(figures.componentName).toMatch(/stat-group/);
    expect(figures.options).toMatchObject({
      fetchUrl: "/api/monitoring/overview/health/figures",
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

  it("leaves the refresh to the Live / Pause control, which can hold it", () => {
    for (const [row, id] of [
      ["health", "errorShare"],
      ["traffic", "chart"],
      ["recent", "activity"],
    ]) {
      const block = child(child(dashboard, row), id);
      expect(block.options?.watchActions).toBeUndefined();
      expect(block.options?.realtimeTopic).toBeUndefined();
    }
  });

  it("reads the verdict while paused, to tell a changed one", () => {
    expect(child(toolbar, "live").options).toMatchObject({
      page: "overview",
      verdictUrl: "/api/monitoring/overview/health/verdict",
    });
  });
});
