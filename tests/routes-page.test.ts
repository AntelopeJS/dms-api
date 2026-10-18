import type { ComponentInfoSerialized } from "@antelopejs/interface-dms/component";
import { describe, expect, it } from "vitest";
import { RoutesPage, thresholdLabel } from "@/pages/routes";

/** The block under `ids`, child by child. */
function blockAt(
  root: ComponentInfoSerialized,
  ids: string[],
): ComponentInfoSerialized {
  return ids.reduce((node, id) => {
    const child = node.children?.find((entry) => entry.id === id);
    if (!child) throw new Error(`no child ${id} under ${node.componentName}`);
    return child.component;
  }, root);
}

describe("RoutesPage", () => {
  it("holds the toolbar of the monitoring pages: scope, live, period", () => {
    const toolbar = RoutesPage.toolbar.serializeSync();
    expect(toolbar.componentName).toBe("dms-page-toolbar-block");
    expect(
      toolbar.children?.map(({ id, component }) => [
        id,
        component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["live", "dms-live-toggle-block"],
      ["period", "dms-period-selector"],
    ]);
  });

  it("offers the period before or no comparison, as a menu", () => {
    const period = blockAt(RoutesPage.toolbar.serializeSync(), ["period"]);
    expect(period.options).toMatchObject({
      id: "api",
      comparisons: ["previous-period", "none"],
      defaultComparison: "previous-period",
      comparisonControl: "menu",
    });
  });

  it("guards the Statistics tab with one empty state while the route has no call", () => {
    const guard = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
    ]);
    expect(guard.componentName).toBe("dms-guard");
    expect(guard.options).toMatchObject({
      fetchUrl:
        "/api/monitoring/routes/statistics/activity?route={{query.route}}",
      periodScope: "api",
      when: "empty",
      field: "calls",
      fallback: { title: "$api.routes.statistics.idle_title" },
    });
    expect(guard.children?.map(({ id }) => id)).toEqual(["grid"]);
  });

  it("keeps the slow threshold within the response time axis, p95 apart", () => {
    const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
      "grid",
      "charts",
      "latency",
      "chart",
    ]);
    expect(options).toMatchObject({
      autoYRange: {},
      color: ["info", "neutral", "secondary"],
      legendPosition: "top",
      rawOptions: [{ key: "markers" }],
    });
  });

  it("shows the latency's delta against the comparison, slower as worse", () => {
    const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
      "grid",
      "charts",
      "latency",
    ]);
    expect(options).toMatchObject({
      showDelta: true,
      invert: true,
      showLegend: true,
    });
  });

  it("names the series of its charts with the DMS series legend", () => {
    for (const chart of ["status", "latency"]) {
      const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
        "tabs",
        "statistics",
        "grid",
        "charts",
        chart,
      ]);
      expect(options).toMatchObject({ showSeriesLegend: true });
    }
  });

  it("labels the response time axis in whole milliseconds", () => {
    const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
      "grid",
      "charts",
      "latency",
    ]);
    expect(options).toMatchObject({ valueFormat: "number", valuePrecision: 0 });
  });
});

describe("thresholdLabel", () => {
  it("writes the threshold the way the console's filters do", () => {
    expect(thresholdLabel(800)).toBe("800 ms");
    expect(thresholdLabel(1000)).toBe("1 s");
    expect(thresholdLabel(1500)).toBe("1.5 s");
    expect(thresholdLabel(2250)).toBe("2.25 s");
  });
});
