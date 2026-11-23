import { HTTPResult } from "@antelopejs/interface-api";
import { User } from "@antelopejs/interface-dms/auth/db";
import { describe, expect, it } from "vitest";
import { SettingsController } from "@/routes/settings";
import { SETTINGS_FIELDS } from "@/services/settings-form";

async function refusal(body: Record<string, number | string>) {
  try {
    await new SettingsController().submitSettings(new User(), body);
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe("a refused settings save", () => {
  it("answers zod's issues in the bytes the form reads", async () => {
    const answer = await refusal({
      [SETTINGS_FIELDS.logRetention]: 0,
      [SETTINGS_FIELDS.slowThreshold]: "fast",
    });

    expect(answer).toBeInstanceOf(HTTPResult);
    if (!(answer instanceof HTTPResult)) return;
    expect([answer.getStatus(), answer.getContentType()]).toEqual([
      400,
      "application/json",
    ]);
    expect(answer.getBody()).toBe(
      '[{"origin":"number","code":"too_small","minimum":1,"inclusive":true,"path":["requestLogRetentionDays"],"message":"Too small: expected number to be >=1"},{"expected":"number","code":"invalid_type","path":["requestSlownessThresholdMs"],"message":"Invalid input: expected number, received string"}]',
    );
  });
});
