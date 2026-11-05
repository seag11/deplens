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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { analyze, DEFAULT_REGISTRY } from "./analyze.ts";
import { LockfileError } from "./lockfile.ts";
import { formatJson, formatText } from "./report.ts";
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

/** Lockfile names in the order npm prefers them. */
const LOCKFILE_NAMES = ["npm-shrinkwrap.json", "package-lock.json"];

const USAGE = `Usage: deplens scan [dir] [options]

Scans the npm lockfile in dir (default: the current folder) for supply chain
risk signals.

Options:
  --fail-on <severity>  Exit with code 1 if any finding is at least this
                        severe: ${SEVERITIES.join(", ")} (default: high)
  --registry <url>      A registry packages may come from. Repeat for several.
                        (default: ${DEFAULT_REGISTRY})
  --json                Print the report as JSON
  -h, --help            Show this help
  --version             Show the version
`;

/** The command line was wrong. Reported with the usage text. */
class UsageError extends Error {
  override name = "UsageError";
}

/** Runs the CLI with the given arguments (without `node` and the script path). */
export function main(argv: readonly string[], io: Io = processIo): number {
  try {
    return run(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`deplens: ${error.message}\n\n${USAGE}`);
    } else if (error instanceof LockfileError) {
      io.stderr(`deplens: ${error.message}\n`);
    } else {
      // Anything else is a bug. Print the stack so it can be reported, and
      // exit with 2 so CI doesn't mistake a crash for findings.
      io.stderr(`deplens: unexpected error\n${(error as Error).stack ?? String(error)}\n`);
    }
    return EXIT_ERROR;
  }
}

function run(argv: readonly string[], io: Io): number {
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

  const report = analyze({ lockfile: readLockfile(dir), registries });
  io.stdout(values.json ? formatJson(report) : formatText(report));

  const failing = report.findings.some((finding) => isAtLeast(finding.severity, failOn));
  return failing ? EXIT_FINDINGS : EXIT_OK;
}

function parseCommandLine(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        "fail-on": { type: "string", default: "high" },
        registry: { type: "string", multiple: true },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    // parseArgs throws a TypeError for unknown options and missing values.
    throw new UsageError((error as Error).message);
  }
}

/** Reads the lockfile npm would use in `dir`. */
function readLockfile(dir: string): string {
  for (const name of LOCKFILE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
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
