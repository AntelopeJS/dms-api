import {
  RegisterActionType,
  RegisterTriggerType,
  UnregisterActionType,
  UnregisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import { getApiHealthAction } from "./get-api-health";
import { queryRequestLogsAction } from "./query-request-logs";
import { routeUnhealthyTrigger } from "./route-unhealthy";

/**
 * Automation nodes contributed by dms-api. The interface package is an
 * optional dependency: with no automation module in the project these
 * registrations are inert no-ops and dms-api keeps working.
 */
export function registerAutomationNodes(): void {
  RegisterTriggerType(routeUnhealthyTrigger);
  RegisterActionType(queryRequestLogsAction);
  RegisterActionType(getApiHealthAction);
}

export function unregisterAutomationNodes(): void {
  UnregisterTriggerType(routeUnhealthyTrigger.id);
  UnregisterActionType(queryRequestLogsAction.id);
  UnregisterActionType(getApiHealthAction.id);
}
