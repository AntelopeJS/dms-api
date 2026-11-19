import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./helpers/dms";
import { resultsOf } from "./helpers/json";

const TESTER_HEADER = "x-antelopejs-api-source";
const SECRET = { testerSourceSecret: "one-secret-for-every-instance" };
const FIFTEEN_MINUTES_MS = 15 * 60_000;

const tokenSchema = z.object({
  header: z.string(),
  expiresAt: z.string(),
  value: z.string(),
});
const sourceSchema = z.object({ source: z.string().nullable() });

describe("tester", () => {
  test("a-secret-keeps-the-testers-token-valid-across-restarts", async ({
    dms,
  }) => {
    const issued = tokenSchema.parse((await dms.mon("/tester/source")).body);
    expect.soft(issued.header, "the header name").toBe(TESTER_HEADER);
    expect
      .soft(
        Math.abs(
          Date.parse(issued.expiresAt) - Date.now() - FIFTEEN_MINUTES_MS,
        ) < 60_000,
        "valid 15 minutes",
      )
      .toBe(true);
    expect.soft(issued.value.length > 10, "a value is given").toBe(true);

    let signedWithSecret = "";
    await dms.withConfig(SECRET, async () => {
      signedWithSecret = tokenSchema.parse(
        (await dms.mon("/tester/source")).body,
      ).value;
    });
    await dms.withConfig(SECRET, async () => {
      await dms.raw({
        path: "/fx/ok",
        headers: { [TESTER_HEADER]: signedWithSecret },
      });
      const marked = await dms.settled(
        "/logs?limit=5",
        (body) => resultsOf(body, sourceSchema).length === 1,
      );
      expect
        .soft(
          resultsOf(marked.body, sourceSchema)[0]?.source,
          "under the same secret the call is the Tester's",
        )
        .toBe("tester");
    });

    await dms.raw({
      path: "/fx/ok",
      headers: { [TESTER_HEADER]: signedWithSecret },
    });
    const logs = await dms.settled(
      "/logs?limit=5",
      (body) => resultsOf(body, sourceSchema).length === 2,
    );
    expect
      .soft(
        resultsOf(logs.body, sourceSchema)[0]?.source,
        "without the secret the call is no longer the Tester's",
      )
      .toBeNull();
  });
});
