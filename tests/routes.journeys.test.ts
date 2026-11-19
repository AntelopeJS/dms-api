import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./helpers/dms";
import { type Json, jsonSchema, resultsOf } from "./helpers/json";
import { seedLogs } from "./helpers/seed";

const REF = "POST /fx/orders/:shop/lines";
const URI = "/fx/orders/:shop/lines";
const DETAIL = `/routes/detail?route=${encodeURIComponent(REF)}`;
const TESTER_SETTLE_MS = 16_000;

const contractSchema = z.object({
  contract: z.object({
    total: z.number(),
    bodyFields: z.array(z.object({ name: z.string(), required: z.boolean() })),
    statuses: z.array(z.object({ status: z.number(), count: z.number() })),
    queryParams: jsonSchema,
    exampleBody: jsonSchema.optional(),
  }),
});

const sourceSchema = z.object({ source: z.string().nullable() });
const tokenSchema = z.object({ value: z.string() });

/** The contract's totals, body fields, statuses and examples, in a fixed order. */
function summarize(body: Json) {
  const { contract } = contractSchema.parse(body);
  return {
    total: contract.total,
    fields: contract.bodyFields
      .map((field) => [field.name, field.required])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    statuses: contract.statuses.map((entry) => [entry.status, entry.count]),
    query: contract.queryParams,
    example: contract.exampleBody,
  };
}

function seeded(daysAgo: number, sku: string, flag: string, shop: string) {
  return {
    daysAgo,
    count: 1,
    method: "POST",
    uri: URI,
    statusCode: 201,
    requestBody: JSON.stringify({ sku, [flag]: true }),
    responseBody: JSON.stringify({ shop }),
  };
}

describe("routes", () => {
  test("the-contract-reads-seven-days-of-real-calls-and-never-the-testers", async ({
    dms,
  }) => {
    await seedLogs(dms, seeded(8, "OLD", "legacy", "old"));
    await seedLogs(dms, seeded(6, "R6", "recent", "recent"));
    await dms.raw({
      method: "POST",
      path: "/fx/orders/shop1/lines?limit=5",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "A1", quantity: 2 }),
    });
    const before = await dms.settled(
      DETAIL,
      (body) => contractSchema.safeParse(body).data?.contract.total === 2,
    );
    const token = tokenSchema.parse((await dms.mon("/tester/source")).body);
    await dms.raw({
      method: "POST",
      path: "/fx/orders/shop9/lines?viaTester=1",
      headers: {
        "content-type": "application/json",
        "x-antelopejs-api-source": token.value,
      },
      body: JSON.stringify({ sku: "T9", quantity: 9, viaTester: true }),
    });
    await dms.settled("/logs?limit=50", (body) =>
      resultsOf(body, sourceSchema).some((row) => row.source === "tester"),
    );
    await new Promise((done) => setTimeout(done, TESTER_SETTLE_MS));
    const after = await dms.mon(DETAIL);

    const seen = summarize(before.body);
    expect.soft(seen.total, "only the calls of the last 7 days count").toBe(2);
    expect
      .soft(
        seen.fields,
        "the 6 day old call's field is documented, the 8 day old one's is not, and a field missing from a call is not required",
      )
      .toEqual([
        ["quantity", false],
        ["recent", false],
        ["sku", true],
      ]);
    expect.soft(seen.statuses, "the statuses seen").toEqual([[201, 2]]);

    const later = summarize(after.body);
    expect
      .soft(later, "the contract is the same after a Tester call")
      .toEqual(seen);
    expect
      .soft(
        later.fields.map((entry) => entry[0]).includes("viaTester"),
        "the Tester's field is not documented",
      )
      .toBe(false);
    expect
      .soft(later.query, "the Tester's query parameter is not documented")
      .toEqual(["limit"]);
  });
});
