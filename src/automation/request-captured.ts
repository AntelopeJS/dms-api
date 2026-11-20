import { Logging } from "@antelopejs/interface-core/logging";
import type {
  JsonSchema,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";
import {
  type RequestLogStatusClass,
  STATUS_CLASS_RANGES,
} from "@/db/models/request_log.status";
import { normalizeRoutePath } from "@/db/tables/routes_statistics.table";
import { onRequestCaptured } from "@/services/request-log/captured";
import { scopeRouteKey } from "@/services/scope";
import { MS_PER_MINUTE } from "@/types";
import {
  HTTP_METHODS,
  objectSchema,
  PATH_PREFIX_INPUT,
  REQUEST_SUMMARY_PROPERTIES,
  ROUTE_REF_MAX_LENGTH,
  type RequestSummary,
  requestSummary,
  requireRouteRef,
} from "./outputs";
import { activeScopeKeys } from "./scope";

interface RequestCapturedConfig {
  statusClasses?: RequestLogStatusClass[];
  statusMin?: number;
  statusMax?: number;
  methods?: string[];
  routes?: string[];
  pathPrefix?: string;
  minResponseTimeMs?: number;
  scope?: "active" | "all";
  includeUnmatched?: boolean;
  includeTester?: boolean;
  maxPerMinute?: number;
}

type RequestCapturedOutput = RequestSummary & {
  deliveryId: string;
  droppedBefore: number;
};

interface RequestCapturedHandle {
  stop(): void;
}

const DEFAULT_STATUS_CLASSES: RequestLogStatusClass[] = ["server-error"];
const DEFAULT_MAX_PER_MINUTE = 30;
const SCOPE_REFRESH_MS = 60_000;

/** The automation builder's own API: a run polled there must not start runs. */
const AUTOMATION_API_PREFIX = "/api/automation";

function underPrefix(path: string, prefix: string): boolean {
  const base = normalizeRoutePath(prefix);
  return base === "/" || path === base || path.startsWith(`${base}/`);
}

/**
 * Whether `row` is a request the trigger never fires on, whatever its
 * config: one an automation procedure sent, or one to the automation API.
 */
export function isAutomationTraffic(row: RequestLogSummaryRow): boolean {
  return (
    row.source === "automation" || underPrefix(row.uri, AUTOMATION_API_PREFIX)
  );
}

/**
 * The config's filters as one test over a stored request. `scopeKeys`
 * answers the route keys of the active scope, undefined while unknown, null
 * when the scope takes every route.
 */
export function captureFilter(
  config: RequestCapturedConfig,
  scopeKeys: () => Set<string> | null | undefined,
): (row: RequestLogSummaryRow) => boolean {
  type Test = (row: RequestLogSummaryRow) => boolean;
  const classes = (
    config.statusClasses?.length ? config.statusClasses : DEFAULT_STATUS_CLASSES
  ).map((name) => STATUS_CLASS_RANGES[name]);
  const tests: Test[] = [
    (row) => !isAutomationTraffic(row),
    (row) => row.source !== "tester" || config.includeTester === true,
    (row) => Boolean(row.routeId) || config.includeUnmatched === true,
    ({ statusCode }) =>
      classes.some(
        (range) =>
          statusCode >= range.min &&
          (range.max === undefined || statusCode < range.max),
      ),
  ];
  const { statusMin, statusMax, minResponseTimeMs, pathPrefix } = config;
  if (statusMin !== undefined) tests.push((row) => row.statusCode >= statusMin);
  if (statusMax !== undefined) tests.push((row) => row.statusCode <= statusMax);
  if (config.methods?.length) {
    const methods = new Set(
      config.methods.map((method) => method.toUpperCase()),
    );
    tests.push((row) => methods.has(row.method.toUpperCase()));
  }
  if (config.routes?.length) {
    const routes = new Set(
      config.routes.map((ref) => requireRouteRef(ref).ref),
    );
    tests.push((row) => {
      const ref = requestSummary(row).route;
      return ref !== null && routes.has(ref);
    });
  }
  if (pathPrefix) tests.push((row) => underPrefix(row.uri, pathPrefix));
  if (minResponseTimeMs !== undefined) {
    tests.push(
      (row) =>
        row.responseTimeMs !== null && row.responseTimeMs >= minResponseTimeMs,
    );
  }
  if (config.scope !== "all") {
    tests.push((row) => {
      if (!row.routeId) return true;
      const keys = scopeKeys();
      if (keys === undefined) return false;
      return (
        keys === null ||
        keys.has(scopeRouteKey(row.routeMethod ?? row.method, row.uri))
      );
    });
  }
  return (row) => tests.every((test) => test(row));
}

/**
 * At most `max` emissions per minute window; the matches over it are
 * counted and handed to the next emission.
 */
export function minuteCap(max: number, now: () => number = Date.now) {
  let window = -1;
  let count = 0;
  let dropped = 0;
  return {
    take(): number | null {
      const current = Math.floor(now() / MS_PER_MINUTE);
      if (current !== window) {
        window = current;
        count = 0;
      }
      if (count >= max) {
        if (count === max) {
          Logging.Warn(
            `[dms-api] request-captured: over ${max} requests this minute, dropping`,
          );
        }
        count += 1;
        dropped += 1;
        return null;
      }
      count += 1;
      const before = dropped;
      dropped = 0;
      return before;
    },
  };
}

const CONFIG_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    statusClasses: {
      type: "array",
      title: "Status classes",
      items: {
        type: "string",
        enum: ["success", "client-error", "server-error"],
      },
      default: DEFAULT_STATUS_CLASSES,
      minItems: 1,
      uniqueItems: true,
    },
    statusMin: { type: "integer", minimum: 100, maximum: 599 },
    statusMax: { type: "integer", minimum: 100, maximum: 599 },
    methods: {
      type: "array",
      items: { type: "string", enum: [...HTTP_METHODS] },
      uniqueItems: true,
    },
    routes: {
      type: "array",
      title: "Routes",
      description: "METHOD /path of the routes that fire; all when empty",
      maxItems: 50,
      items: {
        type: "string",
        maxLength: ROUTE_REF_MAX_LENGTH,
        pattern: "^[A-Za-z]+ /\\S*$",
      },
    },
    pathPrefix: {
      ...PATH_PREFIX_INPUT,
      description: "Only routes under this path (/api/orders)",
    },
    minResponseTimeMs: {
      type: "integer",
      title: "At least this slow (ms)",
      minimum: 1,
      maximum: 600_000,
    },
    scope: {
      type: "string",
      enum: ["active", "all"],
      default: "active",
      description: "active: the routes of the console's scope setting",
    },
    includeUnmatched: {
      type: "boolean",
      default: false,
      description: "Also paths no route answers",
    },
    includeTester: {
      type: "boolean",
      default: false,
      description: "Also the console Tester's calls",
    },
    maxPerMinute: {
      type: "integer",
      default: DEFAULT_MAX_PER_MINUTE,
      minimum: 1,
      maximum: 600,
      description:
        "Emissions per minute on each instance; the excess is dropped and counted",
    },
  },
  additionalProperties: false,
};

/** The trigger, the active scope's route keys read with `readScope`. */
export function requestCapturedTriggerOf(
  readScope: () => Promise<Set<string> | null> = () => activeScopeKeys(),
): TriggerType<
  RequestCapturedConfig,
  RequestCapturedOutput,
  RequestCapturedHandle
> {
  return {
    id: "api.request-captured",
    name: "Request captured",
    description:
      "Fires for each captured API request that matches the filters (status, route, method, duration). Capped per minute",
    icon: "i-ph-arrow-square-in",
    cluster: "replicated",
    configSchema: CONFIG_SCHEMA,
    outputSchema: objectSchema({
      deliveryId: { type: "string", description: "The log id" },
      ...REQUEST_SUMMARY_PROPERTIES,
      droppedBefore: {
        type: "integer",
        minimum: 0,
        description:
          "Matching requests dropped by maxPerMinute on this instance since the previous emission",
      },
    }),
    /**
     * Listens to the capture of this instance: each stored request is tested
     * in memory, without a database read. Requests an automation procedure
     * sent and the automation API's own are never emitted. Under the `active`
     * scope, its route keys are read again every minute.
     */
    async activate(config, emit) {
      let keys: Set<string> | null | undefined;
      let stopped = false;
      const refresh = async () => {
        try {
          keys = await readScope();
        } catch (err) {
          Logging.Error(
            "[dms-api] request-captured scope refresh failed:",
            err,
          );
        }
      };
      const scoped = config.scope !== "all";
      if (scoped) await refresh();
      const timer = scoped
        ? setInterval(() => void refresh(), SCOPE_REFRESH_MS)
        : undefined;
      const matches = captureFilter(config, () => keys);
      const cap = minuteCap(config.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE);
      const unsubscribe = onRequestCaptured((row) => {
        if (stopped || !matches(row)) return;
        const droppedBefore = cap.take();
        if (droppedBefore === null) return;
        emit({ ...requestSummary(row), deliveryId: row._id, droppedBefore });
      });
      return {
        stop() {
          stopped = true;
          clearInterval(timer);
          unsubscribe();
        },
      };
    },
    async deactivate(handle) {
      handle.stop();
    },
  };
}

export const requestCapturedTrigger = requestCapturedTriggerOf();
