import { describe, expect } from "vitest";
import { z } from "zod";
import { TRIGGER_PATH, WITH_NODES } from "./helpers/automation";
import { type Dms, type Fields, test } from "./helpers/dms";
import { readDocuments, seedRouteWatch } from "./helpers/seed";

const CAPTURED = "api.request-captured";
const ROUTES_CHANGED = "api.route-registered";

const activationSchema = z.object({ activation: z.string() });
const emissionsSchema = z.object({
  emissions: z.array(z.object({}).passthrough()),
});
const capturedSchema = z.object({
  uri: z.string(),
  source: z.string().nullable(),
});
const callSchema = z.object({
  ok: z.boolean(),
  statusCode: z.number().nullable(),
  requestId: z.string(),
  dryRun: z.boolean(),
});
const changesSchema = z.object({
  deliveryId: z.string(),
  removed: z.array(z.object({ route: z.string() })),
  registeredCount: z.number(),
});
const loggedSchema = z.object({
  source: z.string().nullish(),
  uri: z.string(),
});
const watchSchema = z.object({ revision: z.string() });

async function activate(dms: Dms, id: string, config: Fields): Promise<string> {
  const answer = await dms.api("POST", `${TRIGGER_PATH}/${id}/activate`, {
    body: config,
    as: "anon",
  });
  return activationSchema.parse(answer.body).activation;
}

async function emissions(dms: Dms, key: string) {
  const answer = await dms.api("GET", `${TRIGGER_PATH}/activation/${key}`, {
    as: "anon",
  });
  return emissionsSchema.parse(answer.body).emissions;
}

async function assertACallRouteIsLoggedAsTheAutomationsAndNeverFeedsRequestCaptured(
  dms: Dms,
): Promise<void> {
  await dms.withEnv(WITH_NODES, async () => {
    const key = await activate(dms, CAPTURED, {
      statusClasses: ["success", "client-error", "server-error"],
      scope: "all",
    });
    const call = callSchema.parse(
      (await dms.runAction("api.call-route", { route: "GET /fx/ok" })).body,
    );
    await dms.traffic([{ path: "/fx/ok", count: 1 }]);
    await new Promise((done) => setTimeout(done, 2_000));
    const logged = await readDocuments(
      dms,
      "dms-api__request_log",
      loggedSchema,
      { requestId: call.requestId },
    );
    const fired = (await emissions(dms, key))
      .map((row) => capturedSchema.parse(row))
      .filter((row) => row.uri === "/fx/ok");
    expect
      .soft([call.ok, call.statusCode, call.dryRun], "the call answered")
      .toEqual([true, 200, false]);
    expect
      .soft(
        logged.map((row) => [row.uri, row.source]),
        "the call is logged as the automation's",
      )
      .toEqual([["/fx/ok", "automation"]]);
    expect
      .soft(
        fired.map((row) => [row.uri, row.source]),
        "only the client's call fires request-captured",
      )
      .toEqual([["/fx/ok", null]]);
    await dms.api("POST", `${TRIGGER_PATH}/${CAPTURED}/deactivate/${key}`, {
      as: "anon",
    });
  });
}

async function assertRouteRegisteredReportsTheChangeSinceTheStoredSetOnce(
  dms: Dms,
): Promise<void> {
  await seedRouteWatch(dms, ["GET /fx/gone", "GET /fx/ok"]);
  await dms.withEnv(WITH_NODES, async () => {
    const first = await activate(dms, ROUTES_CHANGED, { intervalSeconds: 10 });
    await new Promise((done) => setTimeout(done, 2_000));
    const second = await activate(dms, ROUTES_CHANGED, { intervalSeconds: 10 });
    await new Promise((done) => setTimeout(done, 2_000));
    const changes = (await emissions(dms, first)).map((row) =>
      changesSchema.parse(row),
    );
    const stored = await readDocuments(
      dms,
      "dms-api__route_watch",
      watchSchema,
    );
    expect
      .soft(
        changes.map((change) => change.removed.map((route) => route.route)),
        "one run, the route gone since the stored set",
      )
      .toEqual([["GET /fx/gone"]]);
    expect
      .soft(changes[0]?.registeredCount ?? 0, "the routes added since")
      .toBeGreaterThan(0);
    expect
      .soft(
        stored.map((row) => row.revision !== "seeded"),
        "the stored set was replaced",
      )
      .toEqual([true]);
    expect
      .soft(await emissions(dms, second), "the change is not reported again")
      .toEqual([]);
    for (const key of [first, second])
      await dms.api(
        "POST",
        `${TRIGGER_PATH}/${ROUTES_CHANGED}/deactivate/${key}`,
        { as: "anon" },
      );
  });
}

describe("automation calls", () => {
  test("a-call-route-is-logged-as-the-automations-and-never-feeds-request-captured", ({
    dms,
  }) =>
    assertACallRouteIsLoggedAsTheAutomationsAndNeverFeedsRequestCaptured(dms));
  test("route-registered-reports-the-change-since-the-stored-set-once", ({
    dms,
  }) => assertRouteRegisteredReportsTheChangeSinceTheStoredSetOnce(dms));
});
