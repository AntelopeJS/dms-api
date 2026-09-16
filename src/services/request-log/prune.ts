import { getConfig } from "@/config";
import type { RequestLogModel } from "@/db";

/**
 * Delete request logs older than the configured retention window.
 */
export async function pruneRequestLogs(
  model: RequestLogModel,
): Promise<number> {
  const { requestLogRetention } = getConfig();
  const cutoff = new Date(Date.now() - requestLogRetention);
  return model.deleteOlderThan(cutoff);
}
