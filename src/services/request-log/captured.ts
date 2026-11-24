import { Logging } from "@antelopejs/interface-core/logging";
import type { RequestLogSummaryRow } from "@/db/models/request_log.model";

/** Hears of each request the capture stored, as a summary. */
export type CaptureListener = (row: RequestLogSummaryRow) => void;

const listeners = new Set<CaptureListener>();

/** Adds `listener`; the returned function removes it. */
export function onRequestCaptured(listener: CaptureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tells every listener about a stored request. The summary is built only
 * when one listens; a listener that throws is logged and the others still
 * hear of it.
 */
export function notifyCaptured(summary: () => RequestLogSummaryRow): void {
  if (listeners.size === 0) return;
  const row = summary();
  for (const listener of listeners) {
    try {
      listener(row);
    } catch (err) {
      Logging.Error("[dms-api] capture listener failed:", err);
    }
  }
}

/** Removes every listener. */
export function clearCaptureListeners(): void {
  listeners.clear();
}
