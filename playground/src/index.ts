import "./home";
import "./shop";
import { PLAYGROUND_SCHEMA } from "./notes";

import { RegisterSchema } from "@antelopejs/interface-database-decorators";

export async function construct(): Promise<void> {}

export async function start(): Promise<void> {
  await RegisterSchema(PLAYGROUND_SCHEMA);
}

export function destroy(): void {}

export function stop(): void {}
