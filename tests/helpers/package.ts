import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";

const ROOT = join(__dirname, "..", "..");

const dependencies = z.record(z.string()).default({});

const manifestSchema = z.object({
  version: z.string(),
  main: z.string(),
  dmsFrontend: z.string(),
  antelopeJs: z.object({ skills: z.array(z.string()) }),
  dependencies,
  optionalDependencies: dependencies,
});

const packSchema = z.tuple([
  z.object({ files: z.array(z.object({ path: z.string() })) }),
]);

const versionSchema = z.object({ version: z.string() });

const frontendSchema = z.object({
  engines: z.object({ "@antelopejs/dms-frontend": z.string() }),
});

const casesSchema = z.object({
  version: z.number(),
  cases: z.array(
    z.object({
      id: z.string(),
      expect: z.object({ skills: z.array(z.string()) }),
    }),
  ),
});

/** A locale tree read as the dotted keys of its leaves, the empty key standing for a leaf itself. */
const localeKeysSchema: z.ZodType<string[], z.ZodTypeDef, unknown> = z.lazy(
  () =>
    z.union([
      z.string().transform(() => [""]),
      z
        .record(localeKeysSchema)
        .transform((entries) =>
          Object.entries(entries).flatMap(([key, inner]) =>
            inner.map((rest) => (rest ? `${key}.${rest}` : key)),
          ),
        ),
    ]),
);

/** A file of the checkout as text, line endings normalised. */
export function readText(path: string): string {
  return readFileSync(join(ROOT, path), "utf8").replaceAll("\r\n", "\n");
}

/** Whether a file of the checkout exists. */
export function exists(path: string): boolean {
  return existsSync(join(ROOT, path));
}

/** Runs a command at the checkout's root and returns what it printed; throws on a non-zero exit. */
export function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "pipe",
  });
}

/** The root `package.json`. */
export function manifest() {
  return manifestSchema.parse(JSON.parse(readText("package.json")));
}

/** Builds the package, then lists the paths `npm pack` would put in the tarball. */
export function packedFiles(): string[] {
  run("pnpm", ["run", "build"]);
  const packed = packSchema.parse(
    JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"])),
  );
  return packed[0].files.map((file) => file.path);
}

/** The `@antelopejs/dms-frontend` range the Vue layer declares in `engines`. */
export function rendererRange(): string {
  return frontendSchema.parse(JSON.parse(readText("frontend-vue/package.json")))
    .engines["@antelopejs/dms-frontend"];
}

/** The version of an installed package, resolved from the checkout's root. */
export function installedVersion(name: string): string {
  const require = createRequire(join(ROOT, "package.json"));
  return versionSchema.parse(require(`${name}/package.json`)).version;
}

/** The cases file of the published skill. */
export function skillCases() {
  return casesSchema.parse(JSON.parse(readText("skills/dms-api/cases.json")));
}

/** The dotted keys of every leaf of a locale file of the Vue layer. */
export function localeKeys(file: string): string[] {
  return localeKeysSchema.parse(
    JSON.parse(readText(`frontend-vue/i18n/locales/${file}`)),
  );
}
