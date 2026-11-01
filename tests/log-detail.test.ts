import { ImplementInterface } from "@antelopejs/interface-core";
import { GetApiBaseUrl } from "@antelopejs/interface-dms/api-base-url";
import { User } from "@antelopejs/interface-dms/auth/db";
import { beforeAll, describe, expect, it } from "vitest";
import { requestLogTableName } from "@/db/tables/request_log.table";
import { LogsController } from "@/routes/logs";
import { serveTable } from "./helpers/database";

ImplementInterface(
  { GetApiBaseUrl },
  { GetApiBaseUrl: () => Promise.resolve("http://localhost") },
);

beforeAll(() =>
  serveTable(requestLogTableName, [
    {
      _id: "r1",
      timestamp: new Date("2026-10-19T10:00:00Z"),
      method: "GET",
      uri: "/api/orders/:id",
      rawPath: "/api/orders/42",
      statusCode: 200,
    },
  ]),
);

describe("a request opened by its id", () => {
  it("holds the path the panel's title reads, as a listed row does", async () => {
    const detail = await new LogsController().getLog(new User(), "r1");
    expect(detail).toMatchObject({
      method: "GET",
      path: "/api/orders/42",
      rawPath: "/api/orders/42",
    });
  });
});
