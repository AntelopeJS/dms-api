import type { JsonValue } from "@antelopejs/interface-dms-automation";
import { Controller, Get, HTTPResult, JSONBody, Parameter, Post } from "@antelopejs/interface-api";
import { z } from "zod";
import { actions, triggers } from "./registry";

const jsonSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]));

/** A value as JSON: what `JSON.stringify` keeps of it, parsed back into a checked JSON value. */
function asJson(value: JsonValue | void): JsonValue {
  return jsonSchema.parse(JSON.parse(JSON.stringify(value ?? null)));
}

interface Activation {
  handle: unknown;
  emissions: JsonValue[];
  activatedAt: number;
}

const activations = new Map<string, Activation>();
let counter = 0;

/** What a journey does with the nodes the module registered: list them, run an action, arm a trigger and read what it emitted. */
export class AutomationNodesController extends Controller("/verify-api/nodes") {
  @Get("")
  list() {
    return asJson({
      actions: [...actions.values()].map((action) => ({ id: action.id, name: action.name, inputSchema: action.inputSchema, outputSchema: action.outputSchema })),
      triggers: [...triggers.values()].map((trigger) => ({ id: trigger.id, name: trigger.name, cluster: trigger.cluster ?? null, configSchema: trigger.configSchema, outputSchema: trigger.outputSchema })),
    });
  }

  @Post("action/:id")
  async run(@Parameter("id", "param") id: string, @JSONBody() body: JsonValue) {
    const action = actions.get(id);
    if (!action) return new HTTPResult(404, { error: `no action ${id}` });
    const output = await action.execute(body, { procedureId: "verify", runId: "verify", nodeId: "verify", log: () => undefined });
    return asJson(output);
  }

  @Post("trigger/:id/activate")
  async activate(@Parameter("id", "param") id: string, @JSONBody() body: JsonValue) {
    const trigger = triggers.get(id);
    if (!trigger) return new HTTPResult(404, { error: `no trigger ${id}` });
    counter += 1;
    const key = `a${counter}`;
    const activation: Activation = { handle: undefined, emissions: [], activatedAt: Date.now() };
    activation.handle = await trigger.activate(body, (payload) => {
      activation.emissions.push(asJson(payload));
    });
    activations.set(key, activation);
    return { activation: key };
  }

  @Get("trigger/activation/:key")
  emissions(@Parameter("key", "param") key: string) {
    const activation = activations.get(key);
    if (!activation) return new HTTPResult(404, { error: `no activation ${key}` });
    return asJson({ emissions: activation.emissions, ageMs: Date.now() - activation.activatedAt });
  }

  @Post("trigger/:id/deactivate/:key")
  async deactivate(@Parameter("id", "param") id: string, @Parameter("key", "param") key: string) {
    const trigger = triggers.get(id);
    const activation = activations.get(key);
    if (!trigger || !activation) return new HTTPResult(404, { error: "unknown activation" });
    await trigger.deactivate(activation.handle);
    activations.delete(key);
    return { stopped: true };
  }
}
