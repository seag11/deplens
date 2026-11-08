import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import type { Rule } from "../src/types.ts";
import { fakeRegistry, hoursAgo, lockfileText, NOW, packumentOf, registryEntry, version } from "./helpers.ts";

describe("analyze", () => {
  it("attaches the rule, package and dependency path to each finding", async () => {
    const text = lockfileText({
      "": { name: "my-app", dependencies: { a: "^1" } },
      "node_modules/a": registryEntry("a", "1.0.0", { dependencies: { b: "^1" } }),
      "node_modules/b": registryEntry("b", "1.0.0", { hasInstallScript: true }),
    });

    const report = await analyze({ lockfile: text });
    assert.equal(report.packageCount, 2);
    assert.deepEqual(report.findings, [
      {
        ruleId: "DL001",
        ruleName: "install-script",
        severity: "low",
        package: { name: "b", version: "1.0.0" },
        message: "Runs a script when it is installed",
        evidence: { hasInstallScript: true },
        via: ["my-app", "a@1.0.0", "b@1.0.0"],
      },
    ]);
  });

  it("orders findings by severity, then rule, then package", async () => {
    const text = lockfileText({
      "node_modules/z-script": registryEntry("z-script", "1.0.0", { hasInstallScript: true }),
      "node_modules/a-script": registryEntry("a-script", "1.0.0", { hasInstallScript: true }),
      "node_modules/git-lib": { version: "1.0.0", resolved: "github:user/git-lib#abc" },
      "node_modules/no-hash": { version: "1.0.0", resolved: "https://registry.npmjs.org/no-hash/-/no-hash-1.0.0.tgz" },
    });

    const { findings } = await analyze({ lockfile: text });
    assert.deepEqual(
      findings.map((f) => `${f.severity} ${f.ruleId} ${f.package.name}`),
      ["high DL002 no-hash", "medium DL002 git-lib", "low DL001 a-script", "low DL001 z-script"],
    );
  });

  it("trusts only the registries it is given", async () => {
    const text = lockfileText({ "node_modules/a": registryEntry("a", "1.0.0") });
    const report = await analyze({ lockfile: text, registries: ["https://npm.internal.example/"] });
    assert.equal(report.findings[0]?.evidence["source"], "other-host");
  });

  it("checks names against the popular packages it is given", async () => {
    const text = lockfileText({ "node_modules/widgetkit": registryEntry("widgetkit", "1.0.0") });
    assert.deepEqual((await analyze({ lockfile: text })).findings, []);

    const { findings } = await analyze({ lockfile: text, popularPackages: ["widget-kit"] });
    assert.deepEqual(
      findings.map((f) => `${f.ruleId} ${f.package.name}`),
      ["DL003 widgetkit"],
    );
  });

  it("runs only the rules it is given", async () => {
    const flagsEverything: Rule = {
      id: "TEST",
      name: "flags-everything",
      needsRegistry: false,
      why: "",
      fix: "",
      check: () => ({ severity: "medium", message: "flagged", evidence: {} }),
    };
    const text = lockfileText({ "node_modules/a": registryEntry("a", "1.0.0", { hasInstallScript: true }) });

    const { findings } = await analyze({ lockfile: text, rules: [flagsEverything] });
    assert.deepEqual(
      findings.map((f) => f.ruleId),
      ["TEST"],
    );
  });

  describe("offline", () => {
    it("warns which registry rules were skipped", async () => {
      const report = await analyze({ lockfile: lockfileText({}) });
      assert.deepEqual(report.warnings, [
        "Offline: skipped DL004 recent-release, DL005 new-publisher, DL006 provenance-dropped.",
      ]);
    });

    it("doesn't warn when none of the rules need the registry", async () => {
      const report = await analyze({ lockfile: lockfileText({}), rules: [] });
      assert.deepEqual(report.warnings, []);
    });
  });

  describe("online", () => {
    const text = lockfileText({
      "node_modules/fresh-lib": registryEntry("fresh-lib", "2.0.0"),
      "node_modules/git-lib": { version: "1.0.0", resolved: "github:user/git-lib#abc" },
      "node_modules/fresh-lib/node_modules/inner": { version: "1.0.0", inBundle: true },
    });
    const freshLib = packumentOf("fresh-lib", [version("1.0.0"), version("2.0.0", { publishedAt: hoursAgo(5) })]);

    it("passes each package's metadata to the rules", async () => {
      const { client } = fakeRegistry([freshLib]);
      const { findings, warnings } = await analyze({ lockfile: text, registry: client, now: NOW });
      assert.deepEqual(
        findings.filter((f) => f.ruleId === "DL004").map((f) => `${f.package.name} ${f.message}`),
        ["fresh-lib Published 5 hours ago (2026-06-01T07:00:00.000Z)"],
      );
      assert.deepEqual(warnings, []);
    });

    it("fetches only registry packages, once per name", async () => {
      const { client, requests } = fakeRegistry([freshLib]);
      await analyze({ lockfile: text, registry: client, now: NOW });
      // Not git-lib (from git) and not inner (bundled inside fresh-lib).
      assert.deepEqual(requests, [{ name: "fresh-lib", registryUrl: "https://registry.npmjs.org/" }]);
    });

    it("fetches each package from the registry it was downloaded from", async () => {
      const mixed = lockfileText({
        "node_modules/public-lib": registryEntry("public-lib", "1.0.0"),
        "node_modules/@corp/internal": {
          version: "1.0.0",
          resolved: "https://npm.corp.example/repo/@corp/internal/-/internal-1.0.0.tgz",
          integrity: "sha512-AAAA",
        },
      });
      const { client, requests } = fakeRegistry([]);
      await analyze({
        lockfile: mixed,
        registries: ["https://registry.npmjs.org/", "https://npm.corp.example/repo/"],
        registry: client,
        now: NOW,
      });
      assert.deepEqual(
        requests.map((r) => `${r.name} ${r.registryUrl}`).sort(),
        ["@corp/internal https://npm.corp.example/repo/", "public-lib https://registry.npmjs.org/"],
      );
    });

    it("keeps going when metadata is missing, and says which packages were affected", async () => {
      const twoPackages = lockfileText({
        "node_modules/unreachable": registryEntry("unreachable", "1.0.0", { hasInstallScript: true }),
        "node_modules/unknown": registryEntry("unknown", "1.0.0"),
      });
      const { client } = fakeRegistry([], ["unreachable"]);
      const report = await analyze({ lockfile: twoPackages, registry: client, now: NOW });

      // The offline checks still ran.
      assert.deepEqual(
        report.findings.map((f) => `${f.ruleId} ${f.package.name}`),
        ["DL001 unreachable"],
      );
      assert.deepEqual(report.warnings, [
        "Couldn't get registry metadata for 2 packages (unknown, unreachable); registry checks were skipped for them.",
      ]);
    });
  });
});
