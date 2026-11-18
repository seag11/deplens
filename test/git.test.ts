import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { GitError, readFileAtMergeBase } from "../src/git.ts";
import { tempRepo, type TempRepo } from "./temp-repo.ts";

describe("readFileAtMergeBase", () => {
  describe("on a single branch", () => {
    let repo: TempRepo;

    // History: commit 1 has the lockfile at "v1"; commit 2 changes it to
    // "v2" and adds a lockfile in a subfolder.
    before(() => {
      repo = tempRepo();
      repo.write("package-lock.json", "v1");
      repo.commit("first");
      repo.write("package-lock.json", "v2");
      repo.write("apps/web/package-lock.json", "web");
      repo.commit("second");
    });
    after(() => repo.remove());

    it("reads a file at an ancestor ref, which is its own merge base", () => {
      assert.equal(readFileAtMergeBase(repo.dir, "HEAD~1", "package-lock.json"), "v1");
      assert.equal(readFileAtMergeBase(repo.dir, "HEAD", "package-lock.json"), "v2");
    });

    it("reads relative to a subfolder of the repository", () => {
      assert.equal(readFileAtMergeBase(join(repo.dir, "apps/web"), "HEAD", "package-lock.json"), "web");
    });

    it("returns undefined when the file didn't exist there", () => {
      assert.equal(readFileAtMergeBase(join(repo.dir, "apps/web"), "HEAD~1", "package-lock.json"), undefined);
    });

    it("explains a ref that doesn't exist, with a hint for each CI", () => {
      assert.throws(
        () => readFileAtMergeBase(repo.dir, "origin/main", "package-lock.json"),
        (error: Error) =>
          error instanceof GitError &&
          /isn't a commit/.test(error.message) &&
          /GitHub Actions/.test(error.message) &&
          /GitLab CI/.test(error.message) &&
          /Bitbucket Pipelines/.test(error.message),
      );
    });

    it("refuses refs that git would read as options", () => {
      assert.throws(() => readFileAtMergeBase(repo.dir, "--output=/tmp/x", "package-lock.json"), GitError);
    });

    it("reports a folder that isn't in a repository", () => {
      const outside = mkdtempSync(join(tmpdir(), "deplens-not-a-repo-"));
      try {
        assert.throws(() => readFileAtMergeBase(outside, "HEAD", "package-lock.json"), /not a git repository/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe("on a branch that main has moved on from", () => {
    let repo: TempRepo;

    // main:    v1 ──── v2 (an upgrade merged after the branch was made)
    //            \
    // feature:    feature
    before(() => {
      repo = tempRepo();
      repo.write("package-lock.json", "v1");
      repo.commit("shared");
      repo.git("checkout", "--quiet", "-b", "feature");
      repo.write("package-lock.json", "feature");
      repo.commit("feature change");
      repo.git("checkout", "--quiet", "main");
      repo.write("package-lock.json", "v2");
      repo.commit("upgrade on main");
      repo.git("checkout", "--quiet", "feature");
    });
    after(() => repo.remove());

    it("reads where the branch split off, not main's newer version", () => {
      // Comparing against v2 would blame the branch for main's upgrade.
      assert.equal(readFileAtMergeBase(repo.dir, "main", "package-lock.json"), "v1");
    });

    it("reports a ref that shares no history with the current commit", () => {
      repo.git("checkout", "--quiet", "--orphan", "unrelated");
      repo.write("package-lock.json", "unrelated");
      repo.commit("unrelated history");
      assert.throws(() => readFileAtMergeBase(repo.dir, "main", "package-lock.json"), /shares no history/);
    });
  });
});
