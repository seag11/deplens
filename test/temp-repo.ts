/**
 * Throwaway git repositories for tests that need real git history.
 *
 * Each repository lives in the system temp folder and ignores the user's git
 * configuration that could interfere (commit signing, hooks), so tests
 * behave the same on every machine and in CI.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TempRepo {
  /** The repository's root folder. */
  readonly dir: string;
  /** Writes a file, creating folders as needed. `path` is relative to the root. */
  write(path: string, content: string): void;
  /** Stages everything and commits it. */
  commit(message: string): void;
  /** Runs any other git command in the repository, such as `checkout`. */
  git(...args: string[]): string;
  /** Deletes the repository. */
  remove(): void;
}

export function tempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "deplens-test-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.name=deplens tests",
        "-c",
        "user.email=tests@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { encoding: "utf8" },
    );
  // A fixed branch name, whatever the user's init.defaultBranch says.
  git("init", "--quiet", "--initial-branch=main");

  return {
    dir,
    git,
    write(path, content) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    commit(message) {
      git("add", "--all");
      git("commit", "--quiet", "--allow-empty", "--message", message);
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
