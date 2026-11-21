/**
 * The command-line interface.
 *
 * This is the only module that touches the file system and the process.
 * main() takes its output streams as a parameter and returns the exit code
 * instead of exiting, so tests can run it like any other function.
 *
 * Exit codes:
 *   0  no findings at or above --fail-on
 *   1  at least one finding at or above --fail-on
 *   2  usage error, unreadable lockfile, or any other failure
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { analyze, DEFAULT_REGISTRY } from "./analyze.ts";
import { CONFIG_FILE, ConfigError, parseConfig, type Config } from "./config.ts";
import { GitError, readFileAtMergeBase } from "./git.ts";
import { LockfileError } from "./lockfile.ts";
import { HttpRegistryClient, type RegistryClient } from "./registry.ts";
import { formatJson } from "./report/json.ts";
import { formatMarkdown } from "./report/markdown.ts";
import { formatText } from "./report/text.ts";
import { RULES } from "./rules/index.ts";
import { isAtLeast, isSeverity } from "./severity.ts";
import { SEVERITIES } from "./types.ts";

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

/** Where the CLI writes. Tests pass functions that collect the output. */
export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** The outside world the CLI depends on. Tests pass fakes. */
export interface Environment {
  /** Creates the client used for registry metadata (unless --offline). */
  readonly createRegistry: () => RegistryClient;
  /** The current time. */
  readonly now: () => Date;
}

const realEnvironment: Environment = {
  createRegistry: () => new HttpRegistryClient(),
  now: () => new Date(),
};

/** Lockfile names in the order npm prefers them. */
const LOCKFILE_NAMES = ["npm-shrinkwrap.json", "package-lock.json"];

const USAGE = `Usage: deplens scan [dir] [options]

Scans the npm lockfile in dir (default: the current folder) for supply chain
risk signals. Findings to accept can be listed in dir/${CONFIG_FILE}.

Options:
  --base <git-ref>      Check only packages added or changed since the current
                        branch split from this ref, such as origin/main
  --fail-on <severity>  Exit with code 1 if any finding is at least this
                        severe: ${SEVERITIES.join(", ")} (default: high)
  --registry <url>      A registry packages may come from. Repeat for several.
                        (default: ${DEFAULT_REGISTRY})
  --offline             Don't contact the registry. Checks that need registry
                        metadata are skipped.
  --json                Print the report as JSON
  --markdown-file <path>
                        Also write the report as Markdown to this file, for a
                        CI job summary or a pull request comment
  -h, --help            Show this help
  --version             Show the version
`;

/** The command line was wrong. Reported with the usage text. */
class UsageError extends Error {
  override name = "UsageError";
}

/** A report couldn't be written where it was asked for. */
class OutputError extends Error {
  override name = "OutputError";
}

/**
 * Runs the CLI with the given arguments (without `node` and the script path)
 * and resolves to the exit code.
 */
export async function main(
  argv: readonly string[],
  io: Io = processIo,
  env: Environment = realEnvironment,
): Promise<number> {
  try {
    return await run(argv, io, env);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`deplens: ${error.message}\n\n${USAGE}`);
    } else if (
      error instanceof LockfileError ||
      error instanceof GitError ||
      error instanceof ConfigError ||
      error instanceof OutputError
    ) {
      io.stderr(`deplens: ${error.message}\n`);
    } else {
      // Anything else is a bug. Print the stack so it can be reported, and
      // exit with 2 so CI doesn't mistake a crash for findings.
      io.stderr(`deplens: unexpected error\n${(error as Error).stack ?? String(error)}\n`);
    }
    return EXIT_ERROR;
  }
}

async function run(argv: readonly string[], io: Io, env: Environment): Promise<number> {
  const { values, positionals } = parseCommandLine(argv);

  if (values.help) {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout(`${readOwnVersion()}\n`);
    return EXIT_OK;
  }

  const [command, dir = ".", ...extra] = positionals;
  if (command !== "scan") {
    throw new UsageError(command === undefined ? "missing command" : `unknown command "${command}"`);
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"`);

  const failOn = values["fail-on"];
  if (!isSeverity(failOn)) {
    throw new UsageError(`--fail-on must be one of ${SEVERITIES.join(", ")}, not "${failOn}"`);
  }

  const registries = values.registry ?? [DEFAULT_REGISTRY];
  for (const registry of registries) {
    if (!URL.canParse(registry)) throw new UsageError(`--registry "${registry}" isn't a valid URL`);
  }

  const lockfile = readLockfile(dir);
  // The base lockfile is read where the current branch split from --base,
  // under the same file name as the current lockfile. If there was none by
  // that name, every package counts as new.
  const base =
    values.base === undefined ? undefined : { lockfile: readFileAtMergeBase(dir, values.base, lockfile.name) };

  const config = readConfig(dir);

  const report = await analyze({
    lockfile: lockfile.text,
    ...(base ? { base } : {}),
    ignore: config.ignore,
    registries,
    ...(values.offline ? {} : { registry: env.createRegistry() }),
    now: env.now(),
  });
  io.stdout(values.json ? formatJson(report) : formatText(report));
  if (values["markdown-file"] !== undefined) writeReport(values["markdown-file"], formatMarkdown(report));

  const failing = report.findings.some((finding) => isAtLeast(finding.severity, failOn));
  return failing ? EXIT_FINDINGS : EXIT_OK;
}

function parseCommandLine(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        base: { type: "string" },
        "fail-on": { type: "string", default: "high" },
        registry: { type: "string", multiple: true },
        offline: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        "markdown-file": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    // parseArgs throws a TypeError for unknown options and missing values.
    throw new UsageError((error as Error).message);
  }
}

/**
 * Writes a report file, replacing any previous contents. (GitHub's
 * $GITHUB_STEP_SUMMARY is a separate file for each step, so replacing is
 * safe there.)
 */
function writeReport(path: string, content: string): void {
  try {
    writeFileSync(path, content);
  } catch (error) {
    throw new OutputError(`Couldn't write the Markdown report to ${path}: ${(error as Error).message}`);
  }
}

/** Reads `dir/.deplens.json`. The file is optional; without it nothing is ignored. */
function readConfig(dir: string): Config {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return { ignore: [] };
  return parseConfig(
    readFileSync(path, "utf8"),
    RULES.map((rule) => rule.id),
  );
}

/** Reads the lockfile npm would use in `dir`, returning its file name and text. */
function readLockfile(dir: string): { name: string; text: string } {
  for (const name of LOCKFILE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return { name, text: readFileSync(path, "utf8") };
  }
  throw new LockfileError(
    `No package-lock.json or npm-shrinkwrap.json in ${dir}. ` +
      "deplens reads npm lockfiles; run `npm install` to create one.",
  );
}

/** Reads deplens's version from its package.json, one folder above src/ and dist/. */
function readOwnVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(manifest.version);
}
