import "./home";
// Evaluated here on purpose, ahead of the named import below.
// oxlint-disable-next-line import/no-duplicates
import "./notes";

import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { PLAYGROUND_SCHEMA } from "./notes";

export async function construct(): Promise<void> {}

export async function start(): Promise<void> {
  await RegisterSchema(PLAYGROUND_SCHEMA);
}

export function destroy(): void {}

export function stop(): void {}
