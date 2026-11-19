import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

/** The e2e playground: the fixture app, dms-api from this checkout, the DMS, MongoDB and auth modules. */
export const PLAYGROUND = resolve(__dirname, "../../e2e/playground");

const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;
const DROPPED_PREFIXES = [
  "ANTELOPEJS_",
  "npm_",
  "PNPM_",
  "DMS_",
  "MONGO_",
  "VERIFY_API_",
  "NODE_OPTIONS",
];

/** Fresh secrets of a backend: the DMS and auth signing keys and the setup token the first registration presents. */
function newSecrets() {
  const secret = () => randomBytes(18).toString("base64url");
  return {
    DMS_JWT_SECRET: secret(),
    AUTH_JWT_SECRET: secret(),
    DMS_BOOTSTRAP_SECRET: secret(),
    DMS_HTML_RENDER_SECRET: secret(),
    DMS_SESSION_SECRET: secret(),
    DMS_SETUP_TOKEN: secret(),
  };
}

/** The `ajs` command line the playground installs with `@antelopejs/core`. */
function ajsCli(): string {
  const require = createRequire(join(PLAYGROUND, "package.json"));
  return join(
    resolve(require.resolve("@antelopejs/core/package.json"), ".."),
    "dist/core/cli/index.js",
  );
}

/** A loopback port no process listens on. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = z.object({ port: z.number() }).parse(server.address());
      server.close(() => done(port));
    });
  });
}

function inheritedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}

/** Thrown when a backend exits or stays unready: its log since that start says why. */
export class BackendStartError extends Error {
  constructor(
    reason: string,
    readonly log: string,
  ) {
    super(`${reason}\n${log.slice(-4000)}`);
  }
}

/**
 * One backend of the playground on its own port and its own database of a
 * shared MongoDB, run with `ajs project dev`. `extraEnv` is added to the
 * environment of every later start, so a test restarts it under other
 * module options (`VERIFY_API_CONFIG`) or with the automation stand-in
 * (`VERIFY_API_AUTOMATION=1`).
 */
export class Backend {
  readonly secrets = newSecrets();
  readonly logFile: string;
  extraEnv: Record<string, string> = {};
  private child: ChildProcess | null = null;
  private port = 0;

  constructor(
    readonly mongoUrl: string,
    readonly database: string,
  ) {
    const logs = join(tmpdir(), "dms-api-journeys");
    mkdirSync(logs, { recursive: true });
    this.logFile = join(logs, `${database}.log`);
  }

  get apiUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Starts the backend and waits until the DMS answers on its port.
   *
   * @throws {BackendStartError} When it exits first or stays unready for 90 seconds
   */
  async start(): Promise<void> {
    this.port = await freePort();
    const from = this.logSize();
    const log = openSync(this.logFile, "a");
    const child = spawn(
      process.execPath,
      [ajsCli(), "project", "dev", "-e", "docs"],
      {
        cwd: PLAYGROUND,
        stdio: ["ignore", log, log],
        env: {
          ...inheritedEnv(),
          CI: "1",
          NO_COLOR: "1",
          AJS_NO_UPDATE_CHECK: "1",
          NO_UPDATE_NOTIFIER: "1",
          PORT: String(this.port),
          MONGO_URL: this.mongoUrl,
          MONGO_DATABASE: this.database,
          ...this.secrets,
          ...this.extraEnv,
        },
      },
    );
    closeSync(log);
    this.child = child;
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    let gone = false;
    void exited.then(() => (gone = true));
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && !gone) {
      const status = await fetch(`${this.apiUrl}/api/onboarding/informations`, {
        signal: AbortSignal.timeout(2000),
      }).then(
        (response) => response.status,
        () => 0,
      );
      if (status === 200) return;
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    await this.stop();
    throw new BackendStartError(
      gone
        ? "the backend exited before it answered"
        : "the backend did not answer in 90 s",
      this.logSince(from),
    );
  }

  /** Stops the backend, gracefully then by force. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }

  /** Stops the backend and starts it again with the current `extraEnv`. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** The size of the log so far, to read what a later start writes with {@link Backend.logSince}. */
  logSize(): number {
    try {
      return statSync(this.logFile).size;
    } catch {
      return 0;
    }
  }

  /** What the backend logged since the log held `from` bytes. */
  logSince(from = 0): string {
    try {
      return readFileSync(this.logFile).subarray(from).toString("utf8");
    } catch {
      return "";
    }
  }
}
