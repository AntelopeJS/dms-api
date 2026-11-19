import type { ActionType, DataNodeType, TriggerType } from "@antelopejs/interface-dms-automation";

/** The node types the module under verification registered with the stand-in automation provider. */
export const actions = new Map<string, ActionType>();
export const triggers = new Map<string, TriggerType>();
export const dataNodes = new Map<string, DataNodeType>();
