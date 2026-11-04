import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getConfig } from "@/config";
import { LogsPage } from "@/pages/logs";
import { OverviewPage } from "@/pages/overview";

const context = { tenantId: "t1", user: undefined };

/** The options of the request table the tests read, parsed from its serialized block. */
const requestTableOptions = z
  .object({
    queryParamFilters: z.record(z.string(), z.unknown()),
    rowActions: z.object({
      custom: z.array(
        z.object({ isDefault: z.boolean().optional(), target: z.unknown() }),
      ),
    }),
    columns: z.array(
      z.object({
        id: z.string(),
        size: z.number().optional(),
        isVisible: z.boolean().optional(),
      }),
    ),
    emptyStates: z.record(
      z.string(),
      z.object({
        component: z.object({ componentName: z.string() }).optional(),
      }),
    ),
  })
  .passthrough();

/** The request table's options, through {@link requestTableOptions}. */
function tableOptions() {
  return requestTableOptions.parse(LogsPage.requests.serializeSync().options);
}

/** The options of a period selector the tests read, parsed from its serialized block. */
const periodOptions = z.object({ presets: z.array(z.string()) }).passthrough();

describe("LogsPage", () => {
  it("filters its table from the URL, the method included", () => {
    const options = tableOptions();
    expect(Object.keys(options.queryParamFilters).sort()).toEqual([
      "error",
      "method",
      "path",
      "route",
      "since",
      "slow",
      "until",
    ]);
    expect(JSON.stringify(options)).toContain('"periodScope":"api"');
    const period = LogsPage.toolbar
      .serializeSync()
      .children?.find(({ id }) => id === "period");
    expect(period?.component.options).toMatchObject({
      id: "api",
      rememberKey: "api",
      rangeLabel: "relative",
      comparisonControl: "hidden",
      presets: ["last-hour", "last-24h", "last-7-days", "last-30-days", "all"],
    });
    expect(options.quickFilters).toBeUndefined();
  });

  it("holds its rows while a request is open, scrolled, searched or sorted", () => {
    const options = tableOptions();
    expect(options.liveHold).toEqual({
      whileRowOpen: true,
      whileScrolled: true,
      whileSearching: true,
      whileSorted: true,
      missedLabel: "$api.live_mode.new_requests",
    });
  });

  it("opens a request in a DMS drawer on the right on a single click", () => {
    const options = tableOptions();
    expect(options.rowClick).toBe("single");
    expect(JSON.stringify(options)).toContain(
      '"fetchRowUrl":"/api/monitoring/logs/{{row.id}}"',
    );
    const [action] = options.rowActions.custom;
    expect(action?.isDefault).toBe(true);
    expect(action?.target).toMatchObject({
      type: "drawer",
      direction: "right",
      title: "$api.logs.drawer_title",
      rowTitle: "$api.request.heading",
      deepLink: true,
      notFound: {
        title: "$api.request.not_found_title",
        description: "$api.request.not_found_description",
      },
    });
    expect(action?.target).not.toHaveProperty("size");
    expect(action?.target).not.toHaveProperty("positionLabel");
  });

  it("opens its search on /", () => {
    const options = tableOptions();
    expect(options.searchShortcut).toBe("/");
  });

  it("shows the error message under a key no old preference hides", () => {
    const options = tableOptions();
    const ids = options.columns.map((column) => column.id);
    expect(ids.slice(0, 7)).toEqual([
      "timestamp",
      "status",
      "responseTimeMs",
      "method",
      "path",
      "message",
      "_id",
    ]);
    expect(ids).not.toContain("error");
  });

  it("fits its columns beside a docked panel at 1 280 px", () => {
    const options = tableOptions();
    const shown = options.columns.filter(
      (column) => column.isVisible !== false,
    );
    const size = (id: string) =>
      options.columns.find((column) => column.id === id)?.size ?? 0;
    expect(
      size("timestamp") + size("status") + size("responseTimeMs"),
      "Status and duration within the 450 px a docked panel leaves the table.",
    ).toBeLessThanOrEqual(450);
    expect(
      shown.reduce((total, column) => total + (column.size ?? 0), 0),
      "Every shown column within the 865 px a 1 280 px screen leaves them.",
    ).toBeLessThanOrEqual(865);
    expect(shown.map((column) => column.id)).not.toContain("_id");
  });

  it("names the cause of every empty state with its own block", () => {
    const options = tableOptions();
    for (const kind of ["firstRun", "filtered", "error"]) {
      expect(options.emptyStates[kind]?.component?.componentName).toBe(
        "DmsApiLogsEmptyState",
      );
    }
  });
});

describe("LogsPage toolbar and filters", () => {
  it("holds the toolbar of the monitoring pages: scope, live, period", () => {
    const toolbar = LogsPage.toolbar.serializeSync();
    expect(toolbar.componentName).toBe("dms-page-toolbar-block");
    expect(
      toolbar.children?.map((child) => [
        child.id,
        child.component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["live", "dms-live-toggle-block"],
      ["period", "dms-period-selector"],
    ]);
    const live = toolbar.children?.find((child) => child.id === "live");
    expect(live?.component).toMatchObject({
      options: { variant: "pill", missedLabel: "$api.live_mode.new_requests" },
    });
  });

  it("draws the same bar as the Overview, its All time included", () => {
    const logs = LogsPage.toolbar.serializeSync();
    const overview = OverviewPage.toolbar.serializeSync();
    const options = (serialized: typeof logs, id: string) =>
      serialized.children?.find((child) => child.id === id)?.component.options;
    expect(
      logs.options,
      'One size and one set of controls: `PageToolbar` sizes its children, and "All time" draws as its short code, as wide as the other presets.',
    ).toEqual(overview.options);
    expect(options(logs, "live")).toEqual(options(overview, "live"));
    const {
      presets,
      comparisons,
      defaultComparison,
      comparisonControl,
      ...period
    } = periodOptions.parse(options(logs, "period"));
    const overviewPeriod = periodOptions.parse(options(overview, "period"));
    expect(period).toEqual({
      ...overviewPeriod,
      presets: undefined,
      comparisons: undefined,
      defaultComparison: undefined,
      comparisonControl: undefined,
    });
    expect(presets).toEqual([...overviewPeriod.presets, "all"]);
    expect(
      comparisons,
      "A list of requests compares nothing: no comparison menu.",
    ).toEqual(["none"]);
    expect(defaultComparison).toBe("none");
    expect(comparisonControl).toBe("hidden");
  });

  it("serves the slowness threshold and the body limit in force", async () => {
    const filters: unknown = await LogsPage.filters.onFilterCallback?.(
      new Set(),
      {},
      "",
      context,
    );
    expect(filters).toEqual({
      slowThresholdMs: getConfig().requestSlownessThreshold,
    });
    const live: unknown = await LogsPage.live.onFilterCallback?.(
      new Set(),
      { fetchUrl: "/api/monitoring/logs/live" },
      "",
      context,
    );
    expect(live).toMatchObject({
      maxBodyBytes: getConfig().requestLogMaxBodySize,
    });
  });
});
