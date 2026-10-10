import { describe, expect, it } from "vitest";
import {
  applyConfigOverrides,
  getBaseConfig,
  getConfig,
  setConfig,
} from "@/config";

describe("config", () => {
  it("replaces a list instead of adding the defaults to it", () => {
    setConfig({
      requestLogCaptureHeaders: ["content-type", "stripe-signature"],
    });
    expect(getConfig().requestLogCaptureHeaders).toEqual([
      "content-type",
      "stripe-signature",
    ]);
  });

  it("lets a settings override win, and an undefined one fall through", () => {
    setConfig({ requestSlownessThreshold: 800 });
    applyConfigOverrides({
      requestSlownessThreshold: undefined,
      requestLogMaxBodySize: 0,
    });
    expect(getConfig().requestSlownessThreshold).toBe(800);
    expect(getConfig().requestLogMaxBodySize).toBe(0);
    expect(getBaseConfig().requestLogMaxBodySize).toBe(65_536);
    applyConfigOverrides({});
    setConfig();
  });
});
