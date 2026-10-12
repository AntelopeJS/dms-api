import { Logging } from "@antelopejs/interface-core/logging";
import { PublishMessage } from "@antelopejs/interface-dms/realtime";
import { LIVE_REQUESTS_EVENT, LIVE_REQUESTS_TOPIC } from "@/types";

/**
 * The live feed of the console: what the capture logged, told to the pages
 * in live mode through the DMS realtime broker. The Mongo of a plain
 * deployment runs without a replica set, so a change feed of the logs table
 * is not an option; the capture knows when it wrote a log, and says so.
 *
 * One message per logged request: a paused page counts the messages it
 * missed ("40 new · Show"), so a message standing for several requests
 * would under-count them. The DMS gate of a live page (`live: { maxRate }`)
 * keeps a burst from refreshing the blocks more than once per `maxRate`.
 */

/** One logged request, as the feed tells it. */
export interface LiveEntry {
  timestamp: Date;
  statusCode: number;
  /** Sent from the console's Tester: told apart, like the statistics do. */
  tester: boolean;
}

/** Tells the live pages about a request the capture just logged. */
export function recordLiveRequest(entry: LiveEntry): void {
  void PublishMessage(LIVE_REQUESTS_TOPIC, LIVE_REQUESTS_EVENT, {
    payload: {
      timestamp: entry.timestamp.toISOString(),
      statusCode: entry.statusCode,
      tester: entry.tester,
    },
  }).catch((err: unknown) => {
    Logging.Error("[dms-api] live feed publish failed:", err);
  });
}
