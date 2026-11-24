import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { clearCaptureListeners } from "@/services/request-log/captured";
import { routeWatch } from "@/services/route-watch";
import { callRouteAction } from "./call-route";
import { consoleLinkData } from "./console-link";
import { getApiHealthAction } from "./get-api-health";
import { getRequestLogAction } from "./get-request-log";
import { getRouteDetailAction } from "./get-route-detail";
import { getRouteErrorsAction } from "./get-route-errors";
import { getRouteStatisticsAction } from "./get-route-statistics";
import { healthChangedTrigger } from "./health-changed";
import { listIncidentsAction } from "./list-incidents";
import { listRoutesAction } from "./list-routes";
import { listUnhealthyRoutesAction } from "./list-unhealthy-routes";
import { queryRequestLogsAction } from "./query-request-logs";
import { requestCapturedTrigger } from "./request-captured";
import { routeRecoveredTrigger } from "./route-recovered";
import { routeRegisteredTrigger } from "./route-registered";
import { routeUnhealthyTrigger } from "./route-unhealthy";

const AUTOMATION_INTERFACE_PACKAGE = "@antelopejs/interface-dms-automation";

type AutomationInterface =
  typeof import("@antelopejs/interface-dms-automation");

interface ModuleLoadError extends Error {
  code?: string;
}

export const API_TRIGGERS: readonly TriggerType[] = [
  routeUnhealthyTrigger,
  healthChangedTrigger,
  routeRecoveredTrigger,
  requestCapturedTrigger,
  routeRegisteredTrigger,
];

export const API_ACTIONS: readonly ActionType[] = [
  queryRequestLogsAction,
  getApiHealthAction,
  callRouteAction,
  listUnhealthyRoutesAction,
  listIncidentsAction,
  getRouteStatisticsAction,
  getRouteErrorsAction,
  getRequestLogAction,
  getRouteDetailAction,
  listRoutesAction,
];

export const API_DATA_NODES: readonly DataNodeType[] = [consoleLinkData];

let automationInterfacePromise:
  | Promise<AutomationInterface | undefined>
  | undefined;
let registered = false;

/** Whether a load error says the optional automation interface package is not installed, and nothing else. */
export function isMissingAutomationInterface(error: ModuleLoadError): boolean {
  const firstLine = error.message.split("\n", 1)[0] ?? "";
  return (
    ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error.code ?? "") &&
    (firstLine === `Cannot find module '${AUTOMATION_INTERFACE_PACKAGE}'` ||
      firstLine.startsWith(
        `Cannot find package '${AUTOMATION_INTERFACE_PACKAGE}' imported from `,
      ))
  );
}

async function loadAutomationInterface(): Promise<
  AutomationInterface | undefined
> {
  try {
    return await import("@antelopejs/interface-dms-automation");
  } catch (error) {
    if (error instanceof Error && isMissingAutomationInterface(error))
      return undefined;
    throw error;
  }
}

function getAutomationInterface(): Promise<AutomationInterface | undefined> {
  automationInterfacePromise ??= loadAutomationInterface();
  return automationInterfacePromise;
}

function collectErrors(operations: (() => void)[]): unknown[] {
  const errors: unknown[] = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function cleanupAutomationNodes(automation: AutomationInterface): unknown[] {
  return collectErrors([
    ...API_TRIGGERS.map((trigger) => () => {
      automation.UnregisterTriggerType(trigger.id);
    }),
    ...API_ACTIONS.map((action) => () => {
      automation.UnregisterActionType(action.id);
    }),
    ...API_DATA_NODES.map((node) => () => {
      automation.UnregisterDataNodeType(node.id);
    }),
  ]);
}

/**
 * Declares the dms-api automation node types when the optional automation
 * interface package is installed. Without it, or without a module
 * implementing it, dms-api keeps working and the registration is a no-op.
 */
export async function registerAutomationNodes(): Promise<void> {
  const automation = await getAutomationInterface();
  if (!automation || registered) return;
  registered = true;
  try {
    for (const trigger of API_TRIGGERS) automation.RegisterTriggerType(trigger);
    for (const action of API_ACTIONS) automation.RegisterActionType(action);
    for (const node of API_DATA_NODES) automation.RegisterDataNodeType(node);
  } catch (error) {
    cleanupAutomationNodes(automation);
    registered = false;
    throw error;
  }
}

/**
 * Withdraws the node types, and stops the shared route watch and the
 * capture listeners in case the runtime did not deactivate the triggers
 * first.
 */
export async function unregisterAutomationNodes(): Promise<void> {
  routeWatch.stop();
  clearCaptureListeners();
  const automation = await getAutomationInterface();
  if (!automation || !registered) return;
  const errors = cleanupAutomationNodes(automation);
  registered = errors.length > 0;
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Failed to unregister the dms-api automation nodes",
    );
  }
}
