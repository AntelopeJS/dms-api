import { z } from "zod";
import type { Dms } from "./dms";
import type { Json } from "./json";

export const WITH_NODES = { VERIFY_API_AUTOMATION: "1" };
export const HEALTH = "api.get-api-health";
export const LOGS = "api.query-request-logs";
export const UNHEALTHY = "api.route-unhealthy";
export const TRIGGER_PATH = "/dms/fixture-api/nodes/trigger";
export const INTERVAL_WAIT_MS = 12_000;

const propertySchema = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  items: z.object({ enum: z.array(z.unknown()).optional() }).optional(),
});
const propertiesSchema = z
  .object({
    properties: z
      .record(z.string(), propertySchema)
      .transform((record) => new Map(Object.entries(record))),
  })
  .transform((schema) => schema.properties);
const nodeSchema = z.object({
  id: z.string(),
  cluster: z.string().nullish(),
  inputSchema: propertiesSchema.optional(),
  configSchema: propertiesSchema.optional(),
  outputSchema: propertiesSchema,
});
const listedSchema = z.object({
  actions: z.array(z.object({ id: z.string() }).passthrough()),
  triggers: z.array(z.object({ id: z.string() }).passthrough()),
});

/** The nodes of this module (ids under `api.`) that the playground's provider holds, with their schemas parsed. */
export function apiNodes(body: Json) {
  const listed = listedSchema.parse(body);
  const own = (node: { id: string }) => node.id.startsWith("api.");
  return {
    actions: listed.actions.filter(own).map((node) => nodeSchema.parse(node)),
    triggers: listed.triggers.filter(own).map((node) => nodeSchema.parse(node)),
  };
}

export const breakdownSchema = z.object({
  total: z.number(),
  serverErrors: z.number(),
  clientErrors: z.number(),
  success: z.number(),
});
export const healthSchema = z.object({
  totalRoutes: z.number(),
  failingRoutes: z.number(),
  callsToday: z.number(),
  errors24h: z.number(),
  statusBreakdown: breakdownSchema,
});

export const logPageSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      uri: z.string(),
      statusCode: z.number(),
      timestamp: z.string(),
    }),
  ),
  nextCursor: z.string().nullish(),
});

const emissionsSchema = z.object({
  emissions: z.array(
    z.object({
      routeKey: z.string(),
      method: z.string(),
      uri: z.string(),
      flag: z.string(),
      errorRate: z.number(),
      requestsLast24h: z.number(),
    }),
  ),
  ageMs: z.number(),
});
const activationSchema = z.object({ activation: z.string() });
export const attentionSchema = z.object({
  items: z.array(z.object({}).passthrough()),
});
export const verdictSchema = z.object({ verdict: z.string() });
export const lifetimeSchema = z.object({ statisticsLifetimeDays: z.number() });

export function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

export async function arm(
  dms: Dms,
  config: { intervalSeconds: number; flags?: string[] },
): Promise<string> {
  const answer = await dms.api(
    "POST",
    `${TRIGGER_PATH}/${UNHEALTHY}/activate`,
    {
      body: config,
      as: "anon",
    },
  );
  return activationSchema.parse(answer.body).activation;
}

export async function emitted(dms: Dms, key: string) {
  const answer = await dms.api("GET", `${TRIGGER_PATH}/activation/${key}`, {
    as: "anon",
  });
  const { emissions, ageMs } = emissionsSchema.parse(answer.body);
  return {
    flags: emissions.map((row) => `${row.uri}:${row.flag}`).toSorted(byName),
    rows: emissions,
    ageMs,
  };
}

export async function queryLogs(
  dms: Dms,
  input: { [key: string]: string | number },
) {
  const answer = await dms.runAction(LOGS, input);
  return logPageSchema.parse(answer.body);
}

export function hasMore(page: z.infer<typeof logPageSchema>): boolean {
  return (page.nextCursor ?? "") !== "";
}

export function statusesOf(page: z.infer<typeof logPageSchema>): number[] {
  return [...new Set(page.results.map((row) => row.statusCode))];
}
