import { existsSync } from "node:fs";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Backend, PLAYGROUND } from "./backend";

/**
 * Starts the MongoDB every test's backend shares, each on a database of its
 * own, and starts one backend first: the first start of the playground
 * installs its package modules, which parallel starts would race on.
 *
 * @throws When `pnpm e2e:build` has not built the module and the playground
 */
export default async function setup(project: {
  provide: (key: "mongoUrl", value: string) => void;
}): Promise<() => Promise<void>> {
  for (const built of [
    join(PLAYGROUND, "../../../../dist/index.js"),
    join(PLAYGROUND, "dist/index.js"),
  ]) {
    if (!existsSync(built))
      throw new Error(`${built} is missing: run \`pnpm e2e:build\` first`);
  }
  const mongo = await MongoMemoryServer.create();
  const warm = new Backend(mongo.getUri(), "journey_warm_up");
  try {
    await warm.start();
  } finally {
    await warm.stop();
  }
  project.provide("mongoUrl", mongo.getUri());
  return async () => {
    await mongo.stop();
  };
}
