/**
 * Keeps the core of deplens pure: rules and report formatters must never
 * touch the network, the file system, the clock or the process.
 *
 * That's the design rule everything else relies on. Rules get everything they
 * need through their arguments, which keeps them deterministic and testable
 * with plain objects; formatters turn a report into text and nothing more.
 * This test turns the rule from a convention into a check: it follows every
 * import from those folders, transitively, and fails if anything reachable
 *
 *   - imports a Node built-in or any package (deplens has no runtime
 *     dependencies, so any non-relative import is a new capability);
 *   - imports one of deplens's own I/O modules (registry, git, CLI, engine);
 *   - calls a global that reaches outside the program (fetch, the clock,
 *     process, randomness), which an import check alone can't see.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Folders (under src/) whose modules, and everything they import, must be pure. */
const PURE_FOLDERS = ["rules", "report"];

/** deplens's own modules that do I/O by design. Pure code must never reach them. */
const IO_MODULES = ["registry.ts", "git.ts", "cli.ts", "bin.ts", "analyze.ts"];

/** Globals that reach outside the program without an import. */
const IMPURE_GLOBALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch()"],
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bnew Date\s*\(\s*\)/, "new Date() (the current time)"],
  [/\bperformance\.now\s*\(/, "performance.now()"],
  [/\bMath\.random\s*\(/, "Math.random()"],
  [/\bprocess\./, "process"],
  [/\brequire\s*\(/, "require()"],
];

describe("architecture: rules and formatters are pure", () => {
  for (const folder of PURE_FOLDERS) {
    for (const file of readdirSync(join(SRC, folder)).filter((name) => name.endsWith(".ts"))) {
      it(`${folder}/${file} reaches no I/O`, () => {
        assert.deepEqual(impurities(SRC, join(SRC, folder, file), IO_MODULES), []);
      });
    }
  }
});

describe("architecture check itself", () => {
  it("catches I/O imported directly, reached through another module, or used through a global", () => {
    const root = mkdtempSync(join(tmpdir(), "deplens-architecture-"));
    try {
      const write = (path: string, source: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), source);
      };
      write("rules/direct.ts", 'import { readFileSync } from "node:fs";\n');
      write("rules/indirect.ts", 'import { helper } from "../helper.ts";\n');
      write("helper.ts", 'import type { RegistryClient } from "./registry.ts";\nexport const helper = 1;\n');
      write("registry.ts", "export {};\n");
      write("rules/clock.ts", "// Date.now() in a comment is fine.\nexport const now = () => Date.now();\n");
      write("rules/clean.ts", 'import { helper2 } from "./clean-helper.ts";\nconst url = "https://example.com"; // a URL string is fine\n');
      write("rules/clean-helper.ts", "export const helper2 = new Date(0);\n");

      const check = (file: string) => impurities(root, join(root, "rules", file), ["registry.ts"]);
      assert.deepEqual(check("direct.ts"), ['rules/direct.ts imports "node:fs"']);
      assert.deepEqual(check("indirect.ts"), ["rules/indirect.ts → helper.ts imports registry.ts, which does I/O"]);
      assert.deepEqual(check("clock.ts"), ["rules/clock.ts uses Date.now()"]);
      assert.deepEqual(check("clean.ts"), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * Follows every import from `entry`, transitively, and describes each way the
 * reachable code could do I/O. Each problem names the import chain that
 * leads to it, such as `rules/x.ts → packument.ts imports registry.ts`.
 */
function impurities(root: string, entry: string, ioModules: readonly string[]): string[] {
  const problems: string[] = [];
  const chains = new Map<string, string>([[entry, relative(root, entry)]]);
  const queue = [entry];

  for (const file of queue) {
    const chain = chains.get(file)!;
    const source = withoutComments(readFileSync(file, "utf8"));

    for (const [pattern, name] of IMPURE_GLOBALS) {
      if (pattern.test(source)) problems.push(`${chain} uses ${name}`);
    }

    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        problems.push(`${chain} imports "${specifier}"`);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      const name = relative(root, target);
      if (ioModules.includes(name)) {
        problems.push(`${chain} imports ${name}, which does I/O`);
      } else if (!chains.has(target)) {
        chains.set(target, `${chain} → ${name}`);
        queue.push(target);
      }
    }
  }

  return problems;
}

/**
 * Every module specifier in a source file: static imports and re-exports
 * (including `import type`), side-effect imports, and dynamic imports.
 */
function importSpecifiers(source: string): string[] {
  const pattern = /(?:\b(?:import|export)\b[^;"']*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

/**
 * Removes comments, so a comment that mentions `fetch(` or `Date.now()`
 * isn't mistaken for code. A line comment must start the line or follow
 * whitespace, which keeps `https://` inside strings intact.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}
