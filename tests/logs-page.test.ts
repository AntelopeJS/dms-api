import { describe, expect, it } from "vitest";
import { getConfig } from "@/config";
import { LogsPage } from "@/pages/logs";

const context = { tenantId: "t1", user: undefined };

describe("LogsPage", () => {
  it("filters its table from the URL, every period and method included", () => {
    const options = LogsPage.requests.serializeSync().options as Record<
      string,
      unknown
    >;
    expect(Object.keys(options.queryParamFilters as object).sort()).toEqual([
      "all",
      "error",
      "method",
      "path",
      "route",
      "since",
      "slow",
      "until",
    ]);
    // The period is the toolbar selector's, which the table follows.
    expect(JSON.stringify(options)).toContain('"periodScope":"api"');
    // The URL is the one filter state: no quick filter kept in a cookie.
    expect(options.quickFilters).toBeUndefined();
  });

  it("opens a request in the DMS side panel on a single click", () => {
    const options = LogsPage.requests.serializeSync().options as {
      rowClick?: string;
      rowActions: { custom: { isDefault?: boolean; target: unknown }[] };
    };
    expect(options.rowClick).toBe("single");
    expect(JSON.stringify(options)).toContain(
      '"fetchRowUrl":"/api/monitoring/logs/{id}"',
    );
    const [action] = options.rowActions.custom;
    expect(action?.isDefault).toBe(true);
    expect(action?.target).toMatchObject({
      type: "sidePanel",
      title: "$api.logs.drawer_title",
      positionLabel: "$api.request.position",
    });
  });

  it("shows the error message under a key no old preference hides", () => {
    const options = LogsPage.requests.serializeSync().options as {
      columns: { id: string }[];
    };
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
    const options = LogsPage.requests.serializeSync().options as {
      columns: { id: string; size?: number; isVisible?: boolean }[];
    };
    const shown = options.columns.filter(
      (column) => column.isVisible !== false,
    );
    const size = (id: string) =>
      options.columns.find((column) => column.id === id)?.size ?? 0;
    // Status and duration within the 450 px a docked panel leaves the table.
    expect(
      size("timestamp") + size("status") + size("responseTimeMs"),
    ).toBeLessThanOrEqual(450);
    // Every shown column within the 865 px a 1 280 px screen leaves them.
    expect(
      shown.reduce((total, column) => total + (column.size ?? 0), 0),
    ).toBeLessThanOrEqual(865);
    // The request ID folds away, until the column menu shows it.
    expect(shown.map((column) => column.id)).not.toContain("_id");
  });

  it("names the cause of every empty state with its own block", () => {
    const options = LogsPage.requests.serializeSync().options as {
      emptyStates: Record<string, { component?: { componentName: string } }>;
    };
    for (const kind of ["firstRun", "filtered", "error"]) {
      expect(options.emptyStates[kind]?.component?.componentName).toBe(
        "DmsApiLogsEmptyState",
      );
    }
  });

  it("holds the toolbar of the monitoring pages: scope, live, period", () => {
    const toolbar = LogsPage.toolbar.serializeSync() as {
      componentName: string;
      children: { id: string; component: { componentName: string } }[];
    };
    expect(toolbar.componentName).toBe("dms-h-stack");
    expect(
      toolbar.children.map((child) => [
        child.id,
        child.component.componentName,
      ]),
    ).toEqual([
      ["scope", "DmsApiScopeChip"],
      ["spacer", expect.stringMatching(/spacer/)],
      ["live", "dms-live-toggle-block"],
      ["period", "dms-period-selector"],
    ]);
  });

  it("serves the slowness threshold and the body limit in force", async () => {
    const filters = await LogsPage.filters.onFilterCallback?.(
      new Set(),
      {},
      "",
      context,
    );
    expect(filters).toEqual({
      slowThresholdMs: getConfig().requestSlownessThreshold,
    });
    const live = await LogsPage.live.onFilterCallback?.(
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
