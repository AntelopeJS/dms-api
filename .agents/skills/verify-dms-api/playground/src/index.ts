import "./fixture";
import "./fixture-routes";
import "./fixture-members";
import "./automation-stub/routes";
import { ImplementInterface } from "@antelopejs/interface-core";

export async function construct(): Promise<void> {
  if (process.env.VERIFY_API_AUTOMATION !== "1") return;
  ImplementInterface(await import("@antelopejs/interface-dms-automation"), await import("./automation-stub/implementation"));
}

export function start(): void {}

export function destroy(): void {}

export function stop(): void {}
