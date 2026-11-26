import { ImplementInterface } from "@antelopejs/interface-core";
import { GetApiBaseUrl } from "@antelopejs/interface-dms/api-base-url";
import { User } from "@antelopejs/interface-dms/auth/db";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { HTTPResult } from "@antelopejs/interface-api";
import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";
import { requestLogTableName } from "@/db/tables/request_log.table";
import { LogsController } from "@/routes/logs";
import { SettingsController } from "@/routes/settings";
import { REFUSALS } from "@/services/refusals";
import { isHttpResult } from "./helpers/http-result";
import { serveTable } from "./helpers/database";
import en from "../frontend-vue/i18n/locales/api-en-GB.json";
import fr from "../frontend-vue/i18n/locales/api-fr-FR.json";

ImplementInterface(
  { GetApiBaseUrl },
  { GetApiBaseUrl: () => Promise.resolve("http://localhost") },
);

beforeAll(() => serveTable(requestLogTableName, []));

const refusalBody = z.object({
  message: z.string(),
  params: z.record(z.string(), z.union([z.number(), z.string()])),
  severity: z.string(),
});

async function refused<T>(call: () => Promise<T>) {
  try {
    await call();
  } catch (thrown) {
    if (isHttpResult(thrown)) {
      const body = refusalBody.parse(JSON.parse(String(thrown.getBody())));
      return { status: thrown.getStatus(), body };
    }
    throw thrown;
  }
  throw new Error("the call was expected to be refused");
}

interface LocaleTree {
  [name: string]: LocaleTree | string;
}

const localeTree: z.ZodType<LocaleTree> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), localeTree])),
);

function leafKeys(tree: LocaleTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([name, child]) =>
    z.string().safeParse(child).success
      ? [`${prefix}${name}`]
      : leafKeys(localeTree.parse(child), `${prefix}${name}.`),
  );
}

describe("a refused call", () => {
  it("answers an unknown log with a translation key, not an English sentence", async () => {
    const answer = await refused(() =>
      new LogsController().getLog(new User(), "missing"),
    );
    expect(answer).toEqual({
      status: 404,
      body: { message: REFUSALS.logNotFound, params: {}, severity: "error" },
    });
  });

  it("answers a Tester listing without a request id with its key", async () => {
    const answer = await refused(() =>
      new LogsController().listForTester(new User(), {
        rawRequest: new IncomingMessage(new Socket()),
        rawResponse: new ServerResponse(new IncomingMessage(new Socket())),
        url: new URL("http://localhost/x"),
        routeParameters: {},
        response: new HTTPResult(200),
      }),
    );
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ message: REFUSALS.requestIdRequired });
  });

  it("answers an unknown retention field and a bad day count with their keys and bounds", async () => {
    const controller = new SettingsController();
    const field = await refused(() =>
      controller.getRetentionImpact(new User(), "nope", "30"),
    );
    expect(field.body).toMatchObject({
      message: REFUSALS.unknownRetentionField,
    });
    const days = await refused(() =>
      controller.getRetentionImpact(new User(), "statisticsLifetimeDays", "0"),
    );
    expect(days.status).toBe(400);
    expect(days.body).toMatchObject({
      message: REFUSALS.invalidRetentionDays,
      params: { min: 1, max: 366 },
    });
  });

  it("has every refusal key in both locales", () => {
    for (const key of Object.values(REFUSALS)) {
      expect([
        key,
        leafKeys(localeTree.parse(en)).includes(key.slice(1)),
      ]).toEqual([key, true]);
      expect([
        key,
        leafKeys(localeTree.parse(fr)).includes(key.slice(1)),
      ]).toEqual([key, true]);
    }
  });
});
