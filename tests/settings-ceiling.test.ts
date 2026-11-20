import { afterEach, describe, expect, it } from "vitest";
import { applyConfigOverrides, getConfig, setConfig } from "@/config";
import type { ApiSettingsModel } from "@/db";
import { ApiSettings } from "@/db/tables/api_settings.table";
import { loadSettings } from "@/services/settings";

function modelStoring(
  requestLogMaxBodySize: number,
): Pick<ApiSettingsModel, "getSingleton"> {
  return {
    getSingleton: async () =>
      Object.assign(new ApiSettings(), {
        scope: "own",
        requestLogMaxBodySize,
      }),
  };
}

describe("a stored settings override", () => {
  afterEach(() => {
    applyConfigOverrides({});
    setConfig();
  });

  it("is capped to the body capture limit of the config", async () => {
    setConfig({ requestLogMaxBodySize: 1_000 });
    await loadSettings(modelStoring(1_000_000));
    expect(getConfig().requestLogMaxBodySize).toBe(1_000);
  });

  it("still lowers the limit under the config ceiling", async () => {
    setConfig({ requestLogMaxBodySize: 1_000 });
    await loadSettings(modelStoring(200));
    expect(getConfig().requestLogMaxBodySize).toBe(200);
  });
});
