import { Logging } from "@antelopejs/interface-core/logging";
import { PublishMessage } from "@antelopejs/interface-dms/realtime";
import {
  LIVE_BATCH_MS,
  LIVE_REQUESTS_EVENT,
  LIVE_REQUESTS_TOPIC,
} from "@/types";

/**
 * The live feed of the console: what the capture logged, told to the pages
 * in live mode through the DMS realtime broker. The Mongo of a plain
 * deployment runs without a replica set, so a change feed of the logs table
 * is not an option; the capture knows when it wrote a log, and says so.
 *
 * A message per request would flood the pages (each one refreshes its blocks)
 * and the DMS debounce would never let a refresh through under steady
 * traffic: the requests are counted, and the count is published at most once
 * every {@link LIVE_BATCH_MS}.
 */

/** One logged request, as the feed counts it. */
export interface LiveEntry {
  timestamp: Date;
  statusCode: number;
  /** Sent from the console's Tester: counted apart, like the statistics do. */
  tester: boolean;
}

/** What one message says: the requests logged since the previous one. */
export interface LiveBatch {
  /** API requests, the Tester's left out. */
  count: number;
  /** Of `count`, the ones answered with a 5xx. */
  server5xx: number;
  /** Requests the Tester sent. */
  tester: number;
  /** Time of the newest request of the batch (ISO). */
  lastTimestamp: string | null;
}

export interface LiveBatcher {
  add(entry: LiveEntry): void;
  /** Publishes what is waiting now, if anything. */
  flush(): void;
  /** Drops what is waiting and the pending timer. */
  stop(): void;
}

const SERVER_ERROR_MIN = 500;

function emptyBatch(): LiveBatch {
  return { count: 0, server5xx: 0, tester: 0, lastTimestamp: null };
}

/**
 * Counts entries and hands them to `publish` at most once every
 * `intervalMs`: the first entry after a quiet spell starts the wait, the ones
 * arriving meanwhile join it.
 */
export function createLiveBatcher(
  publish: (batch: LiveBatch) => void,
  intervalMs: number = LIVE_BATCH_MS,
): LiveBatcher {
  let batch = emptyBatch();
  let newest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    clearTimeout(timer);
    timer = undefined;
    if (batch.count === 0 && batch.tester === 0) return;
    const ready = batch;
    batch = emptyBatch();
    newest = 0;
    publish(ready);
  }

  return {
    add(entry) {
      if (entry.tester) batch.tester += 1;
      else {
        batch.count += 1;
        if (entry.statusCode >= SERVER_ERROR_MIN) batch.server5xx += 1;
      }
      const at = entry.timestamp.getTime();
      if (at >= newest) {
        newest = at;
        batch.lastTimestamp = entry.timestamp.toISOString();
      }
      timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    stop() {
      clearTimeout(timer);
      timer = undefined;
      batch = emptyBatch();
      newest = 0;
    },
  };
}

function publishBatch(batch: LiveBatch): void {
  void PublishMessage(LIVE_REQUESTS_TOPIC, LIVE_REQUESTS_EVENT, {
    payload: { ...batch },
  }).catch((err: unknown) => {
    Logging.Error("[dms-api] live feed publish failed:", err);
  });
}

let feed: LiveBatcher | null = null;

/** Counts a request the capture just logged into the next live message. */
export function recordLiveRequest(entry: LiveEntry): void {
  feed ??= createLiveBatcher(publishBatch);
  feed.add(entry);
}

/** Stops the feed: on module stop, nothing is published afterwards. */
export function stopLiveFeed(): void {
  feed?.stop();
  feed = null;
}
