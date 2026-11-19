import { describe, expect } from "vitest";
import { z } from "zod";
import { type Dms, type Fields, test } from "./helpers/dms";
import type { Json } from "./helpers/json";

const DAY = 86_400_000;
const KB = 1024;
const FIFTY_HEADERS = Array.from({ length: 50 }, (_, index) => `x-h${index}`);
const SECRET_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
  "X-Authorization",
  "x-antelopejs-api-source",
];
const ORDINARY_HEADERS = [
  "x-request-trace",
  "accept-language",
  "if-none-match",
];
const BOUNDS: { field: string; edges: [Json, number][] }[] = [
  {
    field: "requestLogRetentionDays",
    edges: [
      [0, 400],
      [1, 200],
      [366, 200],
      [367, 400],
      [1.5, 400],
    ],
  },
  {
    field: "statisticsLifetimeDays",
    edges: [
      [45, 400],
      [30, 200],
      [60, 200],
      [90, 200],
      [120, 400],
    ],
  },
  {
    field: "requestLogMaxBodyKb",
    edges: [
      [-1, 400],
      [0, 200],
      [10240, 200],
      [10241, 400],
    ],
  },
  {
    field: "requestSlownessThresholdMs",
    edges: [
      [49, 400],
      [50, 200],
      [75, 400],
      [100, 200],
      [600000, 200],
      [600050, 400],
    ],
  },
  {
    field: "scope",
    edges: [
      ["own", 200],
      ["modules", 200],
      ["all", 200],
      ["everything", 400],
    ],
  },
];
const REFUSED: { name: string; config: Fields }[] = [
  { name: "statisticsLifetime", config: { statisticsLifetime: 45 * DAY } },
  {
    name: "requestSlownessThreshold off its step",
    config: { requestSlownessThreshold: 75 },
  },
  {
    name: "requestLogMaxBodySize above 10 MB",
    config: { requestLogMaxBodySize: 10_241 * KB },
  },
  {
    name: "requestLogRetention of 367 days",
    config: { requestLogRetention: 367 * DAY },
  },
  {
    name: "a secret header",
    config: { requestLogCaptureHeaders: ["authorization"] },
  },
];

const thresholdsSchema = z.object({
  requestSlownessThresholdMs: z.number(),
  requestLogMaxBodyKb: z.number(),
});

async function statusOf(dms: Dms, field: string, value: Json): Promise<number> {
  return (await dms.saveSettings({ [field]: value })).status;
}

function refusedAtStart(outcome: { started: boolean; log: string }) {
  return {
    started: outcome.started,
    said: /\[dms-api\] invalid configuration/.test(outcome.log),
  };
}

async function assertEveryBoundOfTheFormIsEnforcedOnItsEdge(
  dms: Dms,
): Promise<void> {
  for (const { field, edges } of BOUNDS)
    for (const [value, expected] of edges)
      expect
        .soft(
          await statusOf(dms, field, value),
          `${field} = ${JSON.stringify(value)}`,
        )
        .toBe(expected);
  expect
    .soft(
      await statusOf(dms, "requestLogCaptureHeaders", FIFTY_HEADERS),
      "50 headers are accepted",
    )
    .toBe(200);
  expect
    .soft(
      await statusOf(dms, "requestLogCaptureHeaders", [
        ...FIFTY_HEADERS,
        "x-one-more",
      ]),
      "51 headers are refused",
    )
    .toBe(400);
  for (const header of SECRET_HEADERS)
    expect
      .soft(
        await statusOf(dms, "requestLogCaptureHeaders", [header]),
        `${header} is refused`,
      )
      .toBe(400);
  for (const header of ORDINARY_HEADERS)
    expect
      .soft(
        await statusOf(dms, "requestLogCaptureHeaders", [header]),
        `${header} is accepted`,
      )
      .toBe(200);
}

async function assertUseDefaultReturnsAFieldToTheModuleOption(
  dms: Dms,
): Promise<void> {
  await dms.withConfig(
    { requestSlownessThreshold: 500, requestLogMaxBodySize: 2048 },
    async () => {
      const read = async () =>
        thresholdsSchema.parse((await dms.mon("/settings")).body);
      const base = await read();
      await dms.saveSettings({ requestSlownessThresholdMs: 250 });
      const overridden = await read();
      await dms.restart();
      const restarted = await read();
      await dms.saveSettings({ requestSlownessThresholdMs: null });
      const back = await read();
      expect
        .soft(
          base.requestSlownessThresholdMs,
          "the module options are read: slow",
        )
        .toBe(500);
      expect
        .soft(
          base.requestLogMaxBodyKb,
          "the module options are read: body cap in KB",
        )
        .toBe(2);
      expect
        .soft(
          overridden.requestSlownessThresholdMs,
          "the override wins at once",
        )
        .toBe(250);
      expect
        .soft(
          restarted.requestSlownessThresholdMs,
          "the override survives a restart",
        )
        .toBe(250);
      expect
        .soft(
          back.requestSlownessThresholdMs,
          "Use default follows the module option again",
        )
        .toBe(500);
      expect
        .soft(back.requestLogMaxBodyKb, "the other field was never overridden")
        .toBe(2);
    },
  );
}

async function assertTheModuleRefusesToStartWithAValueTheFormWouldRefuse(
  dms: Dms,
): Promise<void> {
  for (const { name, config } of REFUSED) {
    expect
      .soft(
        refusedAtStart(await dms.startWith(config)),
        `${name}: the module stops and says so`,
      )
      .toEqual({ started: false, said: true });
    await dms.restart();
  }
  const accepted = await dms.startWith({
    statisticsLifetime: 60 * DAY,
    requestLogRetention: 14 * DAY,
    requestSlownessThreshold: 500,
    requestLogMaxBodySize: 0,
    requestLogCaptureHeaders: ["x-webhook-signature"],
  });
  expect.soft(accepted.started, "the module starts").toBe(true);
}

async function assertALogRetentionOfNoDayIsRefusedAtStart(
  dms: Dms,
): Promise<void> {
  expect
    .soft(
      refusedAtStart(await dms.startWith({ requestLogRetention: 0 })),
      "the module stops and says so",
    )
    .toEqual({ started: false, said: true });
}

describe("settings", () => {
  test("every-bound-of-the-form-is-enforced-on-its-edge", ({ dms }) =>
    assertEveryBoundOfTheFormIsEnforcedOnItsEdge(dms));
  test("use-default-returns-a-field-to-the-module-option", ({ dms }) =>
    assertUseDefaultReturnsAFieldToTheModuleOption(dms));
  test("the-module-refuses-to-start-with-a-value-the-form-would-refuse", ({
    dms,
  }) => assertTheModuleRefusesToStartWithAValueTheFormWouldRefuse(dms));
  test("a-log-retention-of-no-day-is-refused-at-start", ({ dms }) =>
    assertALogRetentionOfNoDayIsRefusedAtStart(dms));
});
