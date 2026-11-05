import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, main } from "../src/cli.ts";

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

/**
 * The risky-app fixture contains one finding at each severity:
 *   high    old-mirror-lib  downloaded over http
 *   medium  forked-lib      installed from git
 *   low     native-addon    install script
 */
const RISKY = fixture("risky-app");
const CLEAN = fixture("clean-app");
/** One package with an install script, which is a low finding. */
const SCRIPT_ONLY = fixture("script-only-app");

/** Runs the CLI and captures what it prints. */
function run(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe("deplens scan", () => {
  it("exits 0 when nothing is found", () => {
    const { code, stdout } = run("scan", CLEAN);
    assert.equal(code, EXIT_OK);
    assert.equal(stdout, "deplens: no findings in 1 package\n");
  });

  it("reports every finding with its dependency path", () => {
    const { stdout } = run("scan", RISKY);
    assert.match(stdout, /^deplens: 3 findings in 4 packages \(1 high, 1 medium, 1 low\)$/m);
    assert.match(stdout, /via risky-app > some-lib@2\.0\.0 > old-mirror-lib@0\.9\.0/);
  });

  describe("--fail-on", () => {
    it("defaults to high", () => {
      assert.equal(run("scan", RISKY).code, EXIT_FINDINGS);
    });

    it("exits 0 when every finding is below the threshold", () => {
      // An install script on its own is low, so the default doesn't fail on it.
      const { code, stdout } = run("scan", SCRIPT_ONLY);
      assert.match(stdout, /1 finding/);
      assert.equal(code, EXIT_OK);
    });

    it("exits 1 when a finding reaches a lower threshold", () => {
      assert.equal(run("scan", SCRIPT_ONLY, "--fail-on", "low").code, EXIT_FINDINGS);
    });

    it("rejects an unknown severity", () => {
      const { code, stderr } = run("scan", RISKY, "--fail-on", "critical");
      assert.equal(code, EXIT_ERROR);
      assert.match(stderr, /--fail-on must be one of low, medium, high/);
    });
  });

  it("prints JSON with --json", () => {
    const output = JSON.parse(run("scan", RISKY, "--json").stdout);
    assert.deepEqual(output.summary, { low: 1, medium: 1, high: 1 });
  });

  it("rejects an invalid --registry", () => {
    const { code, stderr } = run("scan", RISKY, "--registry", "not a url");
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /isn't a valid URL/);
  });

  it("explains a missing lockfile", () => {
    const { code, stderr } = run("scan", fixture("does-not-exist"));
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /No package-lock\.json/);
  });
});

describe("deplens", () => {
  it("prints usage on --help", () => {
    const { code, stdout } = run("--help");
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /^Usage: deplens scan/);
  });

  it("prints its version", () => {
    assert.match(run("--version").stdout, /^\d+\.\d+\.\d+\n$/);
  });

  it("rejects a missing or unknown command, and unknown options", () => {
    for (const argv of [[], ["audit"], ["scan", "--nope"], ["scan", "a", "b"]]) {
      const { code, stderr } = run(...argv);
      assert.equal(code, EXIT_ERROR, `argv: ${argv.join(" ")}`);
      assert.match(stderr, /Usage:/);
    }
  });
});
