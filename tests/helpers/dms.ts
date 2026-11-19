import { randomBytes, randomUUID } from "node:crypto";
import { inject, test as base } from "vitest";
import { z } from "zod";
import { Backend } from "./backend";
import { type Json, parseBody, resultsOf } from "./json";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUrl: string;
  }
}

/** The console's HTTP API, which the dashboard calls. */
export const MONITOR = "/api/monitoring";

/** Routes the verification playground registers in the project's scope: 17 under /fx, the member route and the five node routes. */
export const FIXTURE_ROUTES = 23;

const SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_POLL_MS = 300;
const REQUEST_TIMEOUT_MS = 30_000;

/** An answer of the API: its status and its JSON body, or its text when it is not JSON. */
export interface Answer {
  status: number;
  body: Json;
}

/** An answer read as sent, redirects not followed. */
export interface Raw {
  status: number;
  headers: Headers;
  bytes: Buffer;
  body: Json;
}

/** Settings, module options or an action's input: JSON fields by name. */
export type Fields = { [key: string]: Json };

interface Account {
  email: string;
  password: string;
}

/** A call to the API: `as` names an account, `admin` by default, and `anon` sends no session. */
export interface Call {
  method?: string;
  body?: Json;
  as?: string;
}

const tokenSchema = z.object({ access_token: z.string() });
const invitationSchema = z.object({ email: z.string(), token: z.string() });
const loggedSchema = z.object({
  _id: z.string(),
  method: z.string(),
  path: z.string(),
  requestId: z.string().nullish(),
});

/** A password the DMS policy accepts: an uppercase letter, a digit and one of `@$!%*?&`. */
function newPassword(): string {
  return `Vr1!${randomBytes(12).toString("base64url").replace(/[-_]/g, "x")}`;
}

/**
 * A DMS of its own for one test: a backend of the playground on a fresh
 * database, its administrator `admin` onboarded, and the accounts the test
 * adds. Every call signs its account in again once when its session was
 * refused, so a restart keeps the accounts usable.
 */
export class Dms {
  private readonly accounts = new Map<string, Account>();
  private readonly tokens = new Map<string, string>();

  private constructor(readonly backend: Backend) {}

  /** Starts a backend on a fresh database and onboards its administrator. */
  static async start(mongoUrl: string): Promise<Dms> {
    const dms = new Dms(
      new Backend(
        mongoUrl,
        `journey_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      ),
    );
    await dms.backend.start();
    const admin = {
      email: `admin-${randomUUID()}@verify.local`,
      password: newPassword(),
    };
    const register = await dms.api("POST", "/api/onboarding/register", {
      body: {
        ...admin,
        firstName: "Verify",
        lastName: "Admin",
        setupToken: dms.backend.secrets.DMS_SETUP_TOKEN,
        platformName: "Verify",
      },
      as: "anon",
    });
    if (register.status !== 200)
      throw new Error(
        `onboarding answered ${register.status}: ${JSON.stringify(register.body)}`,
      );
    dms.accounts.set("admin", admin);
    return dms;
  }

  get apiUrl(): string {
    return this.backend.apiUrl;
  }

  /** Stops the backend. The database stays in the shared MongoDB until the suite ends. */
  stop(): Promise<void> {
    return this.backend.stop();
  }

  /** A call to the backend as an account, its body sent as JSON. */
  async api(
    method: string,
    path: string,
    call: Omit<Call, "method"> = {},
  ): Promise<Answer> {
    const as = call.as ?? "admin";
    const send = async (): Promise<Answer> => {
      const headers = new Headers({ accept: "application/json" });
      if (call.body !== undefined)
        headers.set("content-type", "application/json");
      const token = as === "anon" ? undefined : this.tokens.get(as);
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return {
        status: response.status,
        body: parseBody(await response.text()),
      };
    };
    if (as !== "anon" && !this.tokens.has(as)) await this.signIn(as);
    const first = await send();
    if (first.status !== 401 || as === "anon") return first;
    await this.signIn(as);
    return send();
  }

  /** A call to the console's API under {@link MONITOR}, as the administrator unless `as` says otherwise. */
  mon(path: string, call: Call = {}): Promise<Answer> {
    return this.api(call.method ?? "GET", `${MONITOR}${path}`, {
      body: call.body,
      as: call.as ?? "admin",
    });
  }

  /** Signs an account in and keeps its session. */
  async signIn(account: string): Promise<void> {
    const credentials = this.accounts.get(account);
    if (!credentials) throw new Error(`no account ${account}`);
    const answer = await this.api("POST", "/api/auth/login", {
      body: { ...credentials },
      as: "anon",
    });
    const signedIn = tokenSchema.safeParse(answer.body);
    if (answer.status !== 200 || !signedIn.success)
      throw new Error(`${account} could not sign in: ${answer.status}`);
    this.tokens.set(account, signedIn.data.access_token);
  }

  /** The session token of an account, signing it in first. */
  async tokenOf(account: string): Promise<string> {
    if (!this.tokens.has(account)) await this.signIn(account);
    return this.tokens.get(account) ?? "";
  }

  /**
   * Sends the project's own routes (`/fx/*`) batches of calls, one after
   * the other.
   *
   * @returns How many calls answered each status
   */
  async traffic(
    batches: {
      path: string;
      count: number;
      method?: string;
      headers?: HeadersInit;
      body?: string;
    }[],
  ): Promise<Map<number, number>> {
    const statuses = new Map<number, number>();
    for (const batch of batches) {
      for (let index = 0; index < batch.count; index += 1) {
        const response = await fetch(`${this.apiUrl}${batch.path}`, {
          method: batch.method ?? "GET",
          headers: batch.headers,
          body: batch.body,
        });
        await response.arrayBuffer();
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      }
    }
    return statuses;
  }

  /** Reads the console until `accept` takes the answer, for 15 seconds at most: the capture writes behind the response. */
  async settled(
    path: string,
    accept: (body: Json) => boolean,
  ): Promise<Answer> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let answer = await this.mon(path);
    while (!accept(answer.body) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, SETTLE_POLL_MS));
      answer = await this.mon(path);
    }
    return answer;
  }

  /** A request sent as given, any method, its answer kept byte for byte; `as` adds the account's session. */
  async raw(request: {
    url?: string;
    path?: string;
    method?: string;
    headers?: HeadersInit;
    as?: string;
    body?: string;
  }): Promise<Raw> {
    const headers = new Headers(request.headers);
    if (request.as)
      headers.set("authorization", `Bearer ${await this.tokenOf(request.as)}`);
    const response = await fetch(
      request.url ?? `${this.apiUrl}${request.path ?? "/"}`,
      {
        method: request.method ?? "GET",
        headers,
        redirect: "manual",
        body: request.body,
      },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      body: parseBody(bytes.toString("utf8")),
    };
  }

  /** Saves settings through the settings form's route; `null` returns a field to its module default. */
  saveSettings(values: Fields, as?: string): Promise<Answer> {
    return this.mon("/settings", { method: "POST", body: values, as });
  }

  /**
   * Sends one call to the project's routes and reads back the request log
   * it made, found by its `x-request-id` or by its method and path.
   */
  async sendAndRead(request: {
    method?: string;
    path: string;
    headers?: HeadersInit;
    body?: string;
  }): Promise<{ status: number; log: Json }> {
    const sent = await this.raw(request);
    const path = request.path.split("?")[0];
    const method = request.method ?? "GET";
    const requestId = new Headers(request.headers).get("x-request-id");
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const listed = await this.mon("/logs?limit=50");
      const row = resultsOf(listed.body, loggedSchema).find(
        (entry) =>
          (requestId !== null && entry.requestId === requestId) ||
          (entry.path === path && entry.method === method),
      );
      if (row)
        return {
          status: sent.status,
          log: (await this.mon(`/logs/${row._id}`)).body,
        };
      await new Promise((done) => setTimeout(done, SETTLE_POLL_MS));
    }
    return { status: sent.status, log: null };
  }

  /** Adds a member whose role holds exactly `permissions`, signed up through the playground's invitation route. */
  async member(name: string, permissions: string[]): Promise<void> {
    const invite = invitationSchema.parse(
      (
        await this.api("POST", "/verify-api/member", {
          body: { name, permissions },
          as: "anon",
        })
      ).body,
    );
    const email = invite.email;
    const password = newPassword();
    const signup = await this.api("POST", "/api/auth/signup", {
      body: { name, email, password, lang: "en", token: invite.token },
      as: "anon",
    });
    if (signup.status !== 200)
      throw new Error(
        `${name} could not sign up: ${signup.status} ${JSON.stringify(signup.body)}`,
      );
    this.accounts.set(name, { email, password });
  }

  /** Restarts the backend with the current extra environment. */
  restart(): Promise<void> {
    return this.backend.restart();
  }

  /** Restarts the backend with extra environment variables, runs `body`, then restarts it with the previous ones. */
  async withEnv(
    env: Record<string, string>,
    body: () => Promise<void>,
  ): Promise<void> {
    const previous = { ...this.backend.extraEnv };
    this.backend.extraEnv = { ...previous, ...env };
    try {
      await this.restart();
      await body();
    } finally {
      this.backend.extraEnv = previous;
      await this.restart();
    }
  }

  /** {@link Dms.withEnv} with the module's options (`VERIFY_API_CONFIG`). */
  withConfig(config: Fields, body: () => Promise<void>): Promise<void> {
    return this.withEnv({ VERIFY_API_CONFIG: JSON.stringify(config) }, body);
  }

  /**
   * Restarts the backend with the module's options and tells whether it
   * came back, with what it logged. The extra environment is put back, not
   * the backend: a test restarts it before its next call.
   */
  async startWith(config: Fields): Promise<{ started: boolean; log: string }> {
    const previous = { ...this.backend.extraEnv };
    const from = this.backend.logSize();
    this.backend.extraEnv = {
      ...previous,
      VERIFY_API_CONFIG: JSON.stringify(config),
    };
    let started = true;
    try {
      await this.restart();
    } catch {
      started = false;
    }
    this.backend.extraEnv = previous;
    return { started, log: this.backend.logSince(from) };
  }

  /** Runs an automation action the module registered with the playground's stand-in provider. */
  runAction(id: string, input: Json): Promise<Answer> {
    return this.api("POST", `/dms/verify-api/nodes/action/${id}`, {
      body: input,
      as: "anon",
    });
  }
}

/** `test` with `dms`: a DMS of the test's own, stopped once the test ends. */
export const test = base.extend<{ dms: Dms }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest reads a fixture's dependencies from its first parameter's pattern.
  dms: async ({}, use) => {
    const dms = await Dms.start(inject("mongoUrl"));
    try {
      await use(dms);
    } finally {
      await dms.stop();
    }
  },
});
