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
    expect(toolbar.componentName).toBe("dms-h-stack");
    expect(
      toolbar.children?.map(({ id, component }) => [
        id,
        component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["spacer", expect.stringMatching(/spacer/)],
      ["live", "dms-live-toggle-block"],
      ["period", "DmsApiPeriodWindow"],
    ]);
  });

  it("keeps the slow threshold within the response time axis, p95 apart", () => {
    const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
      "charts",
      "latency",
      "chart",
    ]);
    expect(options).toMatchObject({
      autoYRange: {},
      color: ["info", "neutral", "secondary"],
      rawOptions: [{ key: "legend" }, { key: "markers" }],
    });
  });

  it("labels the response time axis in whole milliseconds", () => {
    const { options } = blockAt(RoutesPage.explorer.serializeSync(), [
      "tabs",
      "statistics",
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
