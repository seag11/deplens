import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, main, type Environment } from "../src/cli.ts";
import type { RegistryClient } from "../src/registry.ts";
import { daysAgo, fakeRegistry, hoursAgo, NOW, packumentOf, version } from "./helpers.ts";

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

/**
 * Registry metadata for the registry packages in the fixtures. Everything is
 * old and unremarkable, so the registry rules stay quiet unless a test says
 * otherwise.
 */
const postinstall = { postinstall: "node build.js" };
const quietRegistry = fakeRegistry([
  packumentOf("some-lib", [version("1.0.0", { publishedAt: daysAgo(90) }), version("2.0.0")]),
  packumentOf("native-addon", [
    version("3.0.0", { publishedAt: daysAgo(90), installScripts: postinstall }),
    version("3.1.0", { installScripts: postinstall }),
  ]),
]).client;

/** Runs the CLI against a fake registry and a fixed clock, capturing its output. */
async function run(argv: string[], registry: RegistryClient = quietRegistry) {
  let stdout = "";
  let stderr = "";
  let registryCreated = false;
  const env: Environment = {
    createRegistry: () => {
      registryCreated = true;
      return registry;
    },
    now: () => NOW,
  };
  const code = await main(argv, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) }, env);
  return { code, stdout, stderr, registryCreated };
}

describe("deplens scan", () => {
  it("exits 0 when nothing is found", async () => {
    const { code, stdout } = await run(["scan", CLEAN]);
    assert.equal(code, EXIT_OK);
    assert.equal(stdout, "deplens: no findings in 1 package\n");
  });

  it("reports every finding with its dependency path", async () => {
    const { stdout } = await run(["scan", RISKY]);
    assert.match(stdout, /^deplens: 3 findings in 4 packages \(1 high, 1 medium, 1 low\)$/m);
    assert.match(stdout, /via risky-app > some-lib@2\.0\.0 > old-mirror-lib@0\.9\.0/);
    assert.match(stdout, /Runs postinstall "node build\.js"/);
  });

  describe("--fail-on", () => {
    it("defaults to high", async () => {
      assert.equal((await run(["scan", RISKY])).code, EXIT_FINDINGS);
    });

    it("exits 0 when every finding is below the threshold", async () => {
      // An old install script, present in earlier versions too, is low.
      const { code, stdout } = await run(["scan", SCRIPT_ONLY]);
      assert.match(stdout, /1 finding/);
      assert.equal(code, EXIT_OK);
    });

    it("exits 1 when a finding reaches a lower threshold", async () => {
      assert.equal((await run(["scan", SCRIPT_ONLY, "--fail-on", "low"])).code, EXIT_FINDINGS);
    });

    it("rejects an unknown severity", async () => {
      const { code, stderr } = await run(["scan", RISKY, "--fail-on", "critical"]);
      assert.equal(code, EXIT_ERROR);
      assert.match(stderr, /--fail-on must be one of low, medium, high/);
    });
  });

  it("checks registry metadata: a fresh version fails --fail-on medium", async () => {
    const fresh = fakeRegistry([
      packumentOf("some-lib", [version("1.0.0"), version("2.0.0", { publishedAt: hoursAgo(2) })]),
    ]).client;
    const { code, stdout } = await run(["scan", CLEAN, "--fail-on", "medium"], fresh);
    assert.match(stdout, /DL004 recent-release/);
    assert.match(stdout, /Published 2 hours ago/);
    assert.equal(code, EXIT_FINDINGS);
  });

  it("with --offline, doesn't contact the registry and says what was skipped", async () => {
    const { stdout, registryCreated } = await run(["scan", CLEAN, "--offline"]);
    assert.equal(registryCreated, false);
    assert.match(stdout, /^note {2}Offline: skipped DL004 recent-release/m);
  });

  it("prints JSON with --json", async () => {
    const output = JSON.parse((await run(["scan", RISKY, "--json"])).stdout);
    assert.deepEqual(output.summary, { low: 1, medium: 1, high: 1 });
  });

  it("rejects an invalid --registry", async () => {
    const { code, stderr } = await run(["scan", RISKY, "--registry", "not a url"]);
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /isn't a valid URL/);
  });

  it("explains a missing lockfile", async () => {
    const { code, stderr } = await run(["scan", fixture("does-not-exist")]);
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr, /No package-lock\.json/);
  });
});

describe("deplens", () => {
  it("prints usage on --help", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, EXIT_OK);
    assert.match(stdout, /^Usage: deplens scan/);
  });

  it("prints its version", async () => {
    assert.match((await run(["--version"])).stdout, /^\d+\.\d+\.\d+\n$/);
  });

  it("rejects a missing or unknown command, and unknown options", async () => {
    for (const argv of [[], ["audit"], ["scan", "--nope"], ["scan", "a", "b"]]) {
      const { code, stderr } = await run(argv);
      assert.equal(code, EXIT_ERROR, `argv: ${argv.join(" ")}`);
      assert.match(stderr, /Usage:/);
    }
  });
});
