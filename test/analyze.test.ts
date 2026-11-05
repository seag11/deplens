import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import type { Rule } from "../src/types.ts";
import { lockfileText, registryEntry } from "./helpers.ts";

describe("analyze", () => {
  it("attaches the rule, package and dependency path to each finding", () => {
    const text = lockfileText({
      "": { name: "my-app", dependencies: { a: "^1" } },
      "node_modules/a": registryEntry("a", "1.0.0", { dependencies: { b: "^1" } }),
      "node_modules/b": registryEntry("b", "1.0.0", { hasInstallScript: true }),
    });

    assert.deepEqual(analyze({ lockfile: text }), {
      packageCount: 2,
      findings: [
        {
          ruleId: "DL001",
          ruleName: "install-script",
          severity: "low",
          package: { name: "b", version: "1.0.0" },
          message: "Runs a script when it is installed",
          evidence: { hasInstallScript: true },
          via: ["my-app", "a@1.0.0", "b@1.0.0"],
        },
      ],
    });
  });

  it("orders findings by severity, then rule, then package", () => {
    const text = lockfileText({
      "node_modules/z-script": registryEntry("z-script", "1.0.0", { hasInstallScript: true }),
      "node_modules/a-script": registryEntry("a-script", "1.0.0", { hasInstallScript: true }),
      "node_modules/git-lib": { version: "1.0.0", resolved: "github:user/git-lib#abc" },
      "node_modules/no-hash": { version: "1.0.0", resolved: "https://registry.npmjs.org/no-hash/-/no-hash-1.0.0.tgz" },
    });

    const order = analyze({ lockfile: text }).findings.map((f) => `${f.severity} ${f.ruleId} ${f.package.name}`);
    assert.deepEqual(order, [
      "high DL002 no-hash",
      "medium DL002 git-lib",
      "low DL001 a-script",
      "low DL001 z-script",
    ]);
  });

  it("trusts only the registries it is given", () => {
    const text = lockfileText({
      "node_modules/a": registryEntry("a", "1.0.0"),
    });
    const report = analyze({ lockfile: text, registries: ["https://npm.internal.example/"] });
    assert.equal(report.findings[0]?.evidence["source"], "other-host");
  });

  it("runs only the rules it is given", () => {
    const flagsEverything: Rule = {
      id: "TEST",
      name: "flags-everything",
      why: "",
      fix: "",
      check: () => ({ severity: "medium", message: "flagged", evidence: {} }),
    };
    const text = lockfileText({ "node_modules/a": registryEntry("a", "1.0.0", { hasInstallScript: true }) });

    const findings = analyze({ lockfile: text, rules: [flagsEverything] }).findings;
    assert.deepEqual(
      findings.map((f) => f.ruleId),
      ["TEST"],
    );
  });
});
