/**
 * Reads files from git history, so a scan can compare against the lockfile on
 * a base branch.
 *
 * This is the only module that runs git, and it uses plain git only: nothing
 * here depends on where the repository is hosted or which CI runs it.
 *
 * Git is called directly (never through a shell), so refs and file names are
 * passed as plain arguments and can't be used for command injection.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

/** Git isn't available, the folder isn't in a repository, or the ref can't be used. */
export class GitError extends Error {
  override name = "GitError";
}

/** Lockfiles in large monorepos can be tens of megabytes; this leaves ample room. */
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** Advice for the usual cause of a missing commit in CI: a shallow clone. */
const FETCH_HINT =
  "In CI, make sure the base branch is fetched with full history, since shallow clones leave it out " +
  "(for example: fetch-depth: 0 in GitHub Actions, GIT_DEPTH: 0 in GitLab CI, clone depth: full in Bitbucket Pipelines).";

/**
 * Reads a file as it was where the current branch split from `ref`.
 *
 * Comparing against the split point (the merge base), not the tip of `ref`,
 * matches how pull request diffs work. If `ref`'s branch has moved on since,
 * its newer changes aren't mistaken for changes made on this branch. When
 * `ref` is an ancestor of the current commit, such as `HEAD~1` or an older
 * SHA, the merge base is `ref` itself.
 *
 * @param dir A folder inside the repository. `fileName` is relative to it.
 * @returns The file's text, or undefined if the file didn't exist there.
 * @throws GitError if git isn't installed, `dir` isn't in a repository, `ref`
 *   isn't a commit, or the current branch shares no history with it.
 */
export function readFileAtMergeBase(dir: string, ref: string, fileName: string): string | undefined {
  // Git reads an argument starting with "-" as an option, and some options
  // write files. A real ref never starts with "-", so refuse it outright.
  if (ref.startsWith("-")) throw new GitError(`"${ref}" isn't a valid git ref`);

  // --end-of-options is a second guard: everything after it is a revision.
  const verify = git(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (verify.status === 1) throw new GitError(`"${ref}" isn't a commit in this repository. ${FETCH_HINT}`);
  if (verify.status !== 0) throw new GitError(failure(verify));
  const refCommit = verify.stdout.trim();

  // From here on only the verified SHA is passed to git.
  const mergeBase = git(dir, ["merge-base", refCommit, "HEAD"]);
  if (mergeBase.status === 1) {
    throw new GitError(`The current commit shares no history with "${ref}". ${FETCH_HINT}`);
  }
  if (mergeBase.status !== 0) throw new GitError(failure(mergeBase));

  // `<commit>:./<path>` is resolved relative to the working directory (dir),
  // which may be a subfolder of the repository.
  const spec = `${mergeBase.stdout.trim()}:./${fileName}`;
  if (git(dir, ["cat-file", "-e", spec]).status !== 0) return undefined;

  const show = git(dir, ["show", spec]);
  if (show.status !== 0) throw new GitError(failure(show));
  return show.stdout;
}

/** Runs git in `dir` and returns the result without throwing on a non-zero exit. */
function git(dir: string, args: readonly string[]): SpawnSyncReturns<string> {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
  if (result.error !== undefined) {
    const notInstalled = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new GitError(notInstalled ? "git isn't installed or isn't on PATH" : result.error.message);
  }
  return result;
}

/** Git's own error message, such as "fatal: not a git repository". */
function failure(result: SpawnSyncReturns<string>): string {
  return result.stderr.trim() || `git exited with code ${result.status}`;
}
