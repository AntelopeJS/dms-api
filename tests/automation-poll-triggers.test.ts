import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthChangedTriggerOf } from "@/automation/health-changed";
import type { HealthOutput } from "@/automation/health-output";
import {
  type RouteHealthSnapshot,
  recoveryOf,
  routeRecoveredTriggerOf,
} from "@/automation/route-recovered";
import type { HealthVerdict } from "@/services/overview";
import type { RouteHealthState } from "@/services/route-health";
import { emptyBucket } from "@/services/traffic";
import { recorder, sequence } from "./helpers/triggers";

const NOW = new Date("2026-11-20T10:00:30.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

function settle(ms = 0): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
}

function verdict(
  value: HealthVerdict,
  verdictSince: string | null = null,
): HealthOutput {
  return {
    verdict: value,
    verdictSince,
    incidentStart: verdictSince ? "2026-11-20T09:50:00.000Z" : null,
    incidentEnd: null,
    durationMs: null,
    serverErrorRate: 0,
    clientErrorRate: 0,
    p95Ms: null,
    requestsPerMinute: 0,
    calls24h: 0,
    serverErrors24h: 0,
    recoveredRoutes: 0,
    routesNeedingAttention: 0,
    scope: "own",
    logsPath: "",
    checkedAt: NOW.toISOString(),
  };
}

const OPERATIONAL = verdict("operational");
const DEGRADED = verdict("degraded", "2026-11-20T09:50:00.000Z");
const DOWN = verdict("down", "2026-11-20T09:58:00.000Z");
const DEGRADED_AGAIN = verdict("degraded", "2026-11-20T09:59:00.000Z");

type HealthEmission = Parameters<
  Parameters<ReturnType<typeof healthChangedTriggerOf>["activate"]>[1]
>[0];

describe("api.health-changed", () => {
  it("seeds silently, then emits each change into a watched verdict with the one it left", async () => {
    const health = sequence(
      OPERATIONAL,
      DEGRADED,
      DEGRADED,
      DOWN,
      DEGRADED_AGAIN,
    );
    const trigger = healthChangedTriggerOf(health.read);
    const { emitted, emit } = recorder<HealthEmission>();
    const handle = await trigger.activate({ intervalSeconds: 10 }, emit);
    await settle();
    expect(emitted).toEqual([]);
    await settle(40_000);
    await trigger.deactivate(handle);
    expect(
      emitted.map((payload) => [payload.previousVerdict, payload.verdict]),
    ).toEqual([
      ["operational", "degraded"],
      ["degraded", "down"],
      ["down", "degraded"],
    ]);
    expect(emitted.map((payload) => payload.deliveryId)).toEqual([
      "api.health-changed:degraded:2026-11-20T09:50:00.000Z",
      "api.health-changed:down:2026-11-20T09:58:00.000Z",
      "api.health-changed:degraded:2026-11-20T09:59:00.000Z",
    ]);
  });

  it("moves its baseline on a verdict it does not watch, without emitting", async () => {
    const health = sequence(OPERATIONAL, DEGRADED, DOWN);
    const trigger = healthChangedTriggerOf(health.read);
    const { emitted, emit } = recorder<HealthEmission>();
    const handle = await trigger.activate(
      { intervalSeconds: 10, verdicts: ["down"] },
      emit,
    );
    await settle(20_000);
    await trigger.deactivate(handle);
    expect(emitted.map((payload) => payload.previousVerdict)).toEqual([
      "degraded",
    ]);
  });

  it("keeps polling after a failing poll, and never polls faster than 10 seconds", async () => {
    const health = sequence<HealthOutput>(
      new Error("database down"),
      OPERATIONAL,
      DEGRADED,
    );
    const trigger = healthChangedTriggerOf(health.read);
    const { emitted, emit } = recorder<HealthEmission>();
    const handle = await trigger.activate({ intervalSeconds: 1 }, emit);
    await settle(9_000);
    expect(health.calls()).toBe(1);
    await settle(11_000);
    await trigger.deactivate(handle);
    expect(emitted).toHaveLength(1);
  });

  it("emits nothing once deactivated, even from a poll in flight", async () => {
    let answer: (output: HealthOutput) => void = () => undefined;
    let calls = 0;
    const trigger = healthChangedTriggerOf(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(OPERATIONAL)
        : new Promise((resolve) => {
            answer = resolve;
          });
    });
    const { emitted, emit } = recorder<HealthEmission>();
    const handle = await trigger.activate({ intervalSeconds: 10 }, emit);
    await settle(10_000);
    await trigger.deactivate(handle);
    answer(DEGRADED);
    await settle(30_000);
    expect(emitted).toEqual([]);
    expect(calls).toBe(2);
  });
});

function routeState(
  state: RouteHealthState["state"],
  fields: Partial<RouteHealthState> = {},
): RouteHealthState {
  return {
    key: "GET:/api/orders",
    method: "GET",
    uri: "/api/orders",
    traffic: { ...emptyBucket(0), requests: 40, serverErrors: 2 },
    issue: null,
    errors: [],
    state,
    verdict: state === "failing" ? "degraded" : "operational",
    incident: null,
    durationMs: null,
    windows: null,
    p95Ms: 120,
    lastCall: NOW,
    ...fields,
  };
}

const BROKEN = { method: "GET", uri: "/api/orders", flag: "broken" as const };

describe("recoveryOf", () => {
  it("reads a failing route back to recovered with its incident's times", () => {
    const recovery = recoveryOf(
      BROKEN,
      "GET:/api/orders",
      routeState("recovered", {
        incident: {
          start: new Date("2026-11-20T09:30:00.000Z"),
          end: new Date("2026-11-20T09:52:00.000Z"),
        },
      }),
      NOW,
    );
    expect(recovery).toMatchObject({
      previousFlag: "broken",
      state: "recovered",
      route: "GET /api/orders",
      incidentStart: "2026-11-20T09:30:00.000Z",
      incidentEnd: "2026-11-20T09:52:00.000Z",
      deliveryId:
        "api.route-recovered:GET:/api/orders:broken:2026-11-20T09:52:00.000Z",
      routePath: "/modules/api/routes?route=GET+%2Fapi%2Forders",
    });
  });

  it("reads a slow route back to healthy, keyed on the poll's minute", () => {
    const recovery = recoveryOf(
      { ...BROKEN, flag: "slow" },
      "GET:/api/orders",
      routeState("healthy"),
      NOW,
    );
    expect(recovery).toMatchObject({
      state: "healthy",
      deliveryId:
        "api.route-recovered:GET:/api/orders:slow:2026-11-20T10:00:00.000Z",
    });
  });

  it("reads a route gone from the lookback as idle, and a route moving to another flag as no recovery", () => {
    expect(recoveryOf(BROKEN, "GET:/api/orders", undefined, NOW)).toMatchObject(
      { state: "idle", requestsLast24h: 0, p95Ms: null },
    );
    expect(
      recoveryOf(BROKEN, "GET:/api/orders", routeState("slow"), NOW),
    ).toBeNull();
  });
});

function snapshot(
  keys: Set<string> | null,
  ...routes: RouteHealthState[]
): RouteHealthSnapshot {
  return { keys, routes: new Map(routes.map((route) => [route.key, route])) };
}

type RecoveryEmission = Parameters<
  Parameters<ReturnType<typeof routeRecoveredTriggerOf>["activate"]>[1]
>[0];

describe("api.route-recovered", () => {
  const users = (state: RouteHealthState["state"]) =>
    routeState(state, { key: "GET:/api/users", uri: "/api/users" });
  const orders = new Set(["GET:/api/orders"]);

  it("seeds silently, emits a watched flag's end once, and forgets a route leaving the scope", async () => {
    const health = sequence(
      snapshot(null, routeState("failing"), users("slow")),
      snapshot(null, routeState("recovered"), users("slow")),
      snapshot(orders, routeState("healthy"), users("slow")),
      snapshot(orders, routeState("healthy"), users("healthy")),
    );
    const trigger = routeRecoveredTriggerOf(health.read);
    const { emitted, emit } = recorder<RecoveryEmission>();
    const handle = await trigger.activate(
      { intervalSeconds: 10, flags: ["broken", "slow"] },
      emit,
    );
    await settle(30_000);
    await trigger.deactivate(handle);
    expect(emitted.map((payload) => [payload.route, payload.state])).toEqual([
      ["GET /api/orders", "recovered"],
    ]);
  });

  it("does not emit the end of a flag it does not watch", async () => {
    const health = sequence(
      snapshot(null, routeState("client-errors")),
      snapshot(null, routeState("healthy")),
    );
    const trigger = routeRecoveredTriggerOf(health.read);
    const { emitted, emit } = recorder<RecoveryEmission>();
    const handle = await trigger.activate({}, emit);
    await settle(60_000);
    await trigger.deactivate(handle);
    expect(emitted).toEqual([]);
  });
});
