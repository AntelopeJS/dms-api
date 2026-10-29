import { ImplementInterface } from "@antelopejs/interface-core";
import { RunQuery } from "@antelopejs/interface-database/query";
import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "@/types";

type Stages = Parameters<typeof RunQuery>[0];

/** What a table holding `rows` answers to `stages`: its rows, or the one row a `get` names, null without one. */
function answer(name: string, rows: readonly object[], stages: Stages) {
  const [schema, instance, table, read, ...rest] = stages;
  const known =
    schema?.stage === "schema" &&
    schema.options?.id === SCHEMA_NAME &&
    instance?.stage === "instance" &&
    table?.stage === "table" &&
    table.options?.id === name &&
    rest.length === 0;
  if (known && !read) return rows.map((row) => structuredClone(row));
  if (known && read.stage === "get") {
    return rows.find((row) => "_id" in row && row._id === read.args[0]) ?? null;
  }
  throw new Error(`The test database answers no ${JSON.stringify(stages)}`);
}

/**
 * Binds the module's schema and serves its table `name`, holding `rows`,
 * through the database interface: the models of the module read it as they
 * read a real database. It answers a read of the whole table and a `get` by
 * id, and refuses every other query.
 */
export async function serveTable(
  name: string,
  rows: readonly object[],
): Promise<void> {
  ImplementInterface(
    { RunQuery },
    {
      RunQuery: (stages: Stages) => Promise.resolve(answer(name, rows, stages)),
    },
  );
  await RegisterSchema(SCHEMA_NAME);
}
