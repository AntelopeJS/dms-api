import type { ControllerClass } from "@antelopejs/interface-api";
import { GetMetadata } from "@antelopejs/interface-core";
import { PageMetadata } from "@antelopejs/interface-dms/page";
import { RegisterPageTopic } from "@antelopejs/interface-dms/realtime";
import { LogsPage } from "./pages/logs";
import { OverviewPage } from "./pages/overview";
import { RoutesPage } from "./pages/routes";
import { LIVE_REQUESTS_TOPIC } from "./types/constants";

/** The pages with a live mode: their sessions receive the live feed. */
const LIVE_PAGES: ControllerClass[] = [OverviewPage, LogsPage, RoutesPage];

/** The full ids of the live pages (`modules.api.monitor.overview`, …). */
export function livePageIds(): string[] {
  return LIVE_PAGES.map(
    (page) => GetMetadata(page, PageMetadata).pageInfo?.fullId ?? "",
  ).filter((fullId) => fullId.length > 0);
}

/**
 * Binds the live feed to the live pages: a session on one of them receives
 * what the capture publishes (`services/live-feed.ts`), and only those.
 */
export function registerLiveTopics(): void {
  for (const pageId of livePageIds()) {
    RegisterPageTopic(pageId, LIVE_REQUESTS_TOPIC);
  }
}
