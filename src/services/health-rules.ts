import type { RequestLogSample } from "@/db/models/request_log.model";
import {
  CRITICAL_ERROR_RATE,
  ELEVATED_ERROR_RATE,
  MS_PER_MINUTE,
} from "@/types";
import { durationOf } from "./traffic";
import type { TimeRange } from "./window";

/**
 * The health rules, one set for the API verdict and for every route, so the
 * Overview, the routes tree and a route's header always agree. Rates are in
 * percent, as the DMS cards read them.
 *
 * - degraded (a route: failing): 5xx ≥ 1 % of the calls of the last 15
 *   minutes, or for the API a p95 at or above the slow threshold;
 * - down: 5xx ≥ 20 % of the calls of the last 5 minutes;
 * - recovered: for 15 minutes after the verdict came back;
 * - a window holding fewer than `minRequests` calls reaches further back
 *   until it holds that many (at most the lookback), and a rate is only read
 *   over `minRequests` calls or more: one 500 out of one call is not an
 *   outage. Such a window only counts while it holds a 5xx (or a slow call)
 *   within the rule's own span: a quiet route comes back 15 minutes after
 *   its last 5xx, however far back its window reaches.
 *
 * Everything is evaluated over the last 24 hours (the lookback), minute by
 * minute, so the start of an incident and the moment it ended are known
 * rather than guessed from the oldest error in the window.
 */
export const HEALTH_THRESHOLDS = {
  degradedServerErrorRate: 1,
  downServerErrorRate: Math.round(CRITICAL_ERROR_RATE * 100),
  windowMinutes: 15,
  downWindowMinutes: 5,
  minRequests: 20,
  recoveryMinutes: 15,
  lookbackMinutes: 24 * 60,
  /** 4xx share from which a route is flagged for its client errors. */
  clientErrorRate: Math.round(ELEVATED_ERROR_RATE * 100),
  /** Share of calls at or above the slow threshold: a p95 at or above it. */
  slowCallRate: 5,
} as const;

const PERCENT = 100;

/** Overall state of the API, or of one route, in the same words. */
export type HealthVerdict =
  | "operational"
  | "degraded"
  | "down"
  | "recovered"
  | "idle";

/** The span of the current or last incident. */
export interface Incident {
  start: Date | null;
  /** When the verdict came back; null while it lasts. */
  end: Date | null;
}

/**
 * The window one rule reads at the end of the lookback (its span, or further
 * back until it holds `minRequests` calls) and what it holds.
 */
export interface RuleWindow {
  from: Date;
  to: Date;
  requests: number;
  serverErrors: number;
}

/** What the rules make of a series of calls at a given moment. */
export interface HealthEvaluation {
  verdict: HealthVerdict;
  /**
   * The current incident, or the last one over the lookback. A null start on
   * an ongoing incident means it began before the lookback.
   */
  incident: Incident | null;
  /** How long the verdict has held; null when longer than the lookback. */
  durationMs: number | null;
  /**
   * The windows the verdict was judged on now: `degraded` (15 minutes) and
   * `down` (5 minutes). Null without a minute-by-minute pass (no call, or a
   * route without a single 5xx).
   */
  windows: { degraded: RuleWindow; down: RuleWindow } | null;
}

export function percentOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * PERCENT : 0;
}

/** Whether `slowCalls` of `timed` calls put the p95 at or above the threshold. */
export function isSlowShare(slowCalls: number, timed: number): boolean {
  return (
    timed >= HEALTH_THRESHOLDS.minRequests &&
    percentOf(slowCalls, timed) > HEALTH_THRESHOLDS.slowCallRate
  );
}

// ---------------------------------------------------------------------------
// Minute-by-minute evaluation
// ---------------------------------------------------------------------------

const OK = 0;
const DEGRADED = 1;
const DOWN = 2;

/** Running totals per minute of the lookback: a window's sum is a difference. */
interface MinuteSeries {
  start: number;
  minutes: number;
  requests: number[];
  serverErrors: number[];
  slowCalls: number[];
  timed: number[];
}

function prefixSeries(
  samples: RequestLogSample[],
  lookback: TimeRange,
  slowThresholdMs: number,
): MinuteSeries {
  const start =
    Math.floor(lookback.from.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  const minutes = Math.max(
    1,
    Math.ceil((lookback.to.getTime() - start) / MS_PER_MINUTE),
  );
  const counts = {
    requests: Array.from({ length: minutes }, () => 0),
    serverErrors: Array.from({ length: minutes }, () => 0),
    slowCalls: Array.from({ length: minutes }, () => 0),
    timed: Array.from({ length: minutes }, () => 0),
  };
  for (const sample of samples) {
    const index = Math.floor(
      (new Date(sample.timestamp).getTime() - start) / MS_PER_MINUTE,
    );
    if (index < 0 || index >= minutes) continue;
    counts.requests[index] += 1;
    if (sample.statusCode >= 500) counts.serverErrors[index] += 1;
    const ms = durationOf(sample);
    if (ms !== null) {
      counts.timed[index] += 1;
      if (ms >= slowThresholdMs) counts.slowCalls[index] += 1;
    }
  }
  const running = (values: number[]) => {
    const sums = [0];
    for (const value of values) sums.push(sums[sums.length - 1] + value);
    return sums;
  };
  return {
    start,
    minutes,
    requests: running(counts.requests),
    serverErrors: running(counts.serverErrors),
    slowCalls: running(counts.slowCalls),
    timed: running(counts.timed),
  };
}

/** Sum of `sums` over the minutes `[from, to]` (indices, inclusive). */
function between(sums: number[], from: number, to: number): number {
  return sums[to + 1] - sums[from];
}

/**
 * First minute of the window ending at minute `at`: `span` minutes back,
 * then further until it holds `minRequests` calls, never before `floor`.
 */
function windowStart(
  series: MinuteSeries,
  at: number,
  span: number,
  floor: number,
): number {
  const from = Math.max(floor, at - span + 1);
  if (between(series.requests, from, at) >= HEALTH_THRESHOLDS.minRequests) {
    return from;
  }
  // Binary search for the latest start that holds enough calls.
  let low = floor;
  let high = from;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (between(series.requests, middle, at) >= HEALTH_THRESHOLDS.minRequests) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** First minutes of the windows the degraded and the down rules read at `at`. */
function ruleWindowsAt(
  series: MinuteSeries,
  at: number,
): { wide: number; narrow: number } {
  const wide = windowStart(series, at, HEALTH_THRESHOLDS.windowMinutes, 0);
  return {
    wide,
    narrow: windowStart(series, at, HEALTH_THRESHOLDS.downWindowMinutes, wide),
  };
}

/**
 * The state at minute `at`. A window reaches back for volume only: its rate
 * counts while the calls that make it bad are recent, a 5xx (or, with
 * `withSlow`, a slow call) within the rule's own span. Otherwise a route
 * called a few times an hour would stay failing for as long as its window
 * holds an old burst, long after its last 5xx: it comes back
 * `windowMinutes` after its last 5xx, as the API does and as the activity
 * journal closes the incident.
 */
function stateAt(series: MinuteSeries, at: number, withSlow: boolean): number {
  const { wide, narrow } = ruleWindowsAt(series, at);
  const requests = between(series.requests, wide, at);
  if (requests < HEALTH_THRESHOLDS.minRequests) return OK;
  const recent = Math.max(0, at - HEALTH_THRESHOLDS.windowMinutes + 1);
  const recentDown = Math.max(0, at - HEALTH_THRESHOLDS.downWindowMinutes + 1);
  const narrowRequests = between(series.requests, narrow, at);
  if (
    narrowRequests >= HEALTH_THRESHOLDS.minRequests &&
    between(series.serverErrors, recentDown, at) > 0 &&
    percentOf(between(series.serverErrors, narrow, at), narrowRequests) >=
      HEALTH_THRESHOLDS.downServerErrorRate
  ) {
    return DOWN;
  }
  const serverErrors = between(series.serverErrors, wide, at);
  if (
    between(series.serverErrors, recent, at) > 0 &&
    percentOf(serverErrors, requests) >=
      HEALTH_THRESHOLDS.degradedServerErrorRate
  ) {
    return DEGRADED;
  }
  if (
    withSlow &&
    between(series.slowCalls, recent, at) > 0 &&
    isSlowShare(
      between(series.slowCalls, wide, at),
      between(series.timed, wide, at),
    )
  ) {
    return DEGRADED;
  }
  return OK;
}

function minuteTime(series: MinuteSeries, index: number): Date {
  return new Date(series.start + index * MS_PER_MINUTE);
}

/**
 * When the incident whose first bad minute is `runStart` began: the first
 * failing (or, with `withSlow`, slow) call of the window that tipped it,
 * never before the previous incident ended.
 */
function incidentStartOf(
  samples: RequestLogSample[],
  series: MinuteSeries,
  runStart: number,
  floor: number,
  rule: { slowThresholdMs: number; withSlow: boolean },
): Date {
  const from = minuteTime(
    series,
    windowStart(series, runStart, HEALTH_THRESHOLDS.windowMinutes, floor),
  ).getTime();
  const to = minuteTime(series, runStart + 1).getTime();
  let first: number | null = null;
  for (const sample of samples) {
    const at = new Date(sample.timestamp).getTime();
    if (at < from || at >= to || (first !== null && at >= first)) continue;
    const ms = durationOf(sample);
    const bad =
      sample.statusCode >= 500 ||
      (rule.withSlow && ms !== null && ms >= rule.slowThresholdMs);
    if (bad) first = at;
  }
  return first === null ? minuteTime(series, runStart) : new Date(first);
}

/**
 * The verdict the rules give `samples` (one route's, or the whole scope's)
 * at the end of `lookback`, with the incident it belongs to.
 */
export function evaluateHealth(
  samples: RequestLogSample[],
  lookback: TimeRange,
  slowThresholdMs: number,
  withSlow: boolean,
): HealthEvaluation {
  if (samples.length === 0) {
    return { verdict: "idle", incident: null, durationMs: null, windows: null };
  }
  const series = prefixSeries(samples, lookback, slowThresholdMs);
  const states = Array.from({ length: series.minutes }, (_, at) =>
    stateAt(series, at, withSlow),
  );
  const now = lookback.to.getTime();
  const last = series.minutes - 1;
  const current = states[last];
  const windows = windowsAt(series, last, lookback.to);
  // The last run of bad minutes: [runStart, runEnd].
  let runEnd = last;
  while (runEnd >= 0 && states[runEnd] === OK) runEnd--;
  if (runEnd < 0) {
    return {
      verdict: "operational",
      incident: null,
      durationMs: null,
      windows,
    };
  }
  let runStart = runEnd;
  while (runStart > 0 && states[runStart - 1] !== OK) runStart--;
  let previousEnd = runStart - 1;
  while (previousEnd >= 0 && states[previousEnd] === OK) previousEnd--;
  const start =
    runStart === 0
      ? null
      : incidentStartOf(samples, series, runStart, previousEnd + 1, {
          slowThresholdMs,
          withSlow,
        });
  if (current !== OK) {
    let stateStart = last;
    while (stateStart > 0 && states[stateStart - 1] === current) stateStart--;
    const since =
      current === DOWN
        ? stateStart === 0
          ? null
          : minuteTime(series, stateStart)
        : start;
    return {
      verdict: current === DOWN ? "down" : "degraded",
      incident: { start, end: null },
      durationMs: since ? now - since.getTime() : null,
      windows,
    };
  }
  const end = minuteTime(series, runEnd + 1);
  const sinceEnd = now - end.getTime();
  return {
    verdict:
      sinceEnd < HEALTH_THRESHOLDS.recoveryMinutes * MS_PER_MINUTE
        ? "recovered"
        : "operational",
    incident: { start, end },
    durationMs: sinceEnd,
    windows,
  };
}

/** The windows the rules read at minute `at`, the last one ending at `to`. */
function windowsAt(
  series: MinuteSeries,
  at: number,
  to: Date,
): NonNullable<HealthEvaluation["windows"]> {
  const { wide, narrow } = ruleWindowsAt(series, at);
  const window = (from: number): RuleWindow => ({
    from: minuteTime(series, from),
    to,
    requests: between(series.requests, from, at),
    serverErrors: between(series.serverErrors, from, at),
  });
  return { degraded: window(wide), down: window(narrow) };
}

/**
 * A rule's window as the payloads carry it, its rate in percent: what a
 * verdict, or a route's state, was read over.
 */
export interface RuleWindowInfo {
  from: string;
  to: string;
  minutes: number;
  requests: number;
  serverErrors: number;
  serverErrorRate: number;
}

/** What the degraded (15 minutes) and the down (5 minutes) rules read now. */
export interface RuleWindowsInfo {
  degraded: RuleWindowInfo;
  down: RuleWindowInfo;
}

const TWO_DECIMALS = 100;

function ruleWindowInfo(window: RuleWindow): RuleWindowInfo {
  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    minutes: Math.round(
      (window.to.getTime() - window.from.getTime()) / MS_PER_MINUTE,
    ),
    requests: window.requests,
    serverErrors: window.serverErrors,
    serverErrorRate:
      Math.round(
        percentOf(window.serverErrors, window.requests) * TWO_DECIMALS,
      ) / TWO_DECIMALS,
  };
}

/** The windows of an evaluation, as the payloads carry them. */
export function ruleWindowsInfo(
  windows: HealthEvaluation["windows"],
): RuleWindowsInfo | null {
  return windows
    ? {
        degraded: ruleWindowInfo(windows.degraded),
        down: ruleWindowInfo(windows.down),
      }
    : null;
}
