import { Logging } from "@antelopejs/interface-core/logging";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { currentHealth, type HealthVerdict } from "@/services/overview";
import { getActiveScope } from "@/services/settings";
import {
  HEALTH_OUTPUT_PROPERTIES,
  type HealthOutput,
  healthOutput,
} from "./health-output";
import {
  INTERVAL_CONFIG,
  objectSchema,
  POLL_BOUNDS,
  pollIntervalMs,
  pollMinute,
  VERDICTS,
} from "./outputs";
import { refreshSettings } from "./scope";

interface HealthChangedConfig {
  intervalSeconds?: number;
  verdicts?: HealthVerdict[];
}

type HealthChangedOutput = HealthOutput & {
  deliveryId: string;
  previousVerdict: HealthVerdict;
};

interface HealthChangedHandle {
  timer?: NodeJS.Timeout;
  stopped: boolean;
}

const DEFAULT_VERDICTS: HealthVerdict[] = ["degraded", "down", "recovered"];

/** Same for one entry into a verdict, whichever instance saw it. */
export function healthDeliveryId(output: HealthOutput): string {
  const since =
    output.verdictSince ??
    output.incidentStart ??
    pollMinute(new Date(output.checkedAt));
  return `api.health-changed:${output.verdict}:${since}`;
}

/** Reads the API verdict a poll compares with the previous one. */
export type HealthReader = () => Promise<HealthOutput>;

/** The verdict of the routes under the saved scope, the settings read again first. */
export async function readHealth(): Promise<HealthOutput> {
  await refreshSettings();
  return healthOutput(await currentHealth(), getActiveScope());
}

/** The trigger, polling the verdict `read` answers. */
export function healthChangedTriggerOf(
  read: HealthReader = readHealth,
): TriggerType<HealthChangedConfig, HealthChangedOutput, HealthChangedHandle> {
  return {
    id: "api.health-changed",
    name: "API health changed",
    description:
      "Fires when the API's health verdict changes, by the rules the Overview shows: degraded, down, recovered, operational or idle",
    icon: "i-ph-pulse",
    cluster: "singleton",
    configSchema: {
      type: "object",
      properties: {
        intervalSeconds: INTERVAL_CONFIG,
        verdicts: {
          type: "array",
          title: "Verdicts that fire",
          items: { type: "string", enum: [...VERDICTS] },
          default: DEFAULT_VERDICTS,
          minItems: 1,
          uniqueItems: true,
        },
      },
      additionalProperties: false,
    },
    outputSchema: objectSchema({
      deliveryId: { type: "string" },
      previousVerdict: { type: "string", enum: [...VERDICTS] },
      ...HEALTH_OUTPUT_PROPERTIES,
    }),
    /**
     * Polls the verdict and emits when it differs from the previous poll's and
     * the new one is watched. The first poll seeds the baseline silently; a
     * verdict not watched still moves it. A failing poll keeps the timer.
     */
    async activate(config, emit) {
      const watched = new Set<HealthVerdict>(
        config.verdicts?.length ? config.verdicts : DEFAULT_VERDICTS,
      );
      const handle: HealthChangedHandle = { stopped: false };
      let previous: HealthVerdict | undefined;
      let polling = false;

      const poll = async () => {
        if (polling || handle.stopped) return;
        polling = true;
        try {
          const output = await read();
          const before = previous;
          previous = output.verdict;
          if (
            before !== undefined &&
            before !== output.verdict &&
            watched.has(output.verdict) &&
            !handle.stopped
          ) {
            emit({
              ...output,
              deliveryId: healthDeliveryId(output),
              previousVerdict: before,
            });
          }
        } catch (err) {
          Logging.Error("[dms-api] health-changed poll failed:", err);
        } finally {
          polling = false;
        }
      };

      void poll();
      handle.timer = setInterval(
        () => void poll(),
        pollIntervalMs(config.intervalSeconds, POLL_BOUNDS),
      );
      return handle;
    },
    async deactivate(handle) {
      handle.stopped = true;
      clearInterval(handle.timer);
    },
  };
}

export const healthChangedTrigger = healthChangedTriggerOf();
