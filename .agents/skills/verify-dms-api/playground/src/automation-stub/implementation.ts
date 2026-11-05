import type { ActionType, DataNodeType, TriggerType } from "@antelopejs/interface-dms-automation";
import { actions, dataNodes, triggers } from "./registry";

/**
 * The part of `@antelopejs/interface-dms-automation` a node-contributing module talks to, without the
 * automation runtime: registrations are kept so the verification routes can run each node.
 */
export namespace internal {
  export const RegisterTriggerType = {
    register: (id: string, type: TriggerType): void => {
      triggers.set(id, type);
    },
    unregister: (id: string): void => {
      triggers.delete(id);
    },
  };

  export const RegisterActionType = {
    register: (id: string, type: ActionType): void => {
      actions.set(id, type);
    },
    unregister: (id: string): void => {
      actions.delete(id);
    },
  };

  export const RegisterDataNodeType = {
    register: (id: string, type: DataNodeType): void => {
      dataNodes.set(id, type);
    },
    unregister: (id: string): void => {
      dataNodes.delete(id);
    },
  };
}

export async function ListTriggerTypes(): Promise<TriggerType[]> {
  return [...triggers.values()];
}

export async function ListActionTypes(): Promise<ActionType[]> {
  return [...actions.values()];
}

export async function ListDataNodeTypes(): Promise<DataNodeType[]> {
  return [...dataNodes.values()];
}

export async function InvokeProcedure(): Promise<never> {
  throw new Error("the verification stand-in runs no procedure");
}

export async function RunProcedure(): Promise<never> {
  throw new Error("the verification stand-in runs no procedure");
}

export async function DeclareProcedure(): Promise<never> {
  throw new Error("the verification stand-in runs no procedure");
}
