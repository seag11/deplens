import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatJson, formatText } from "../src/report.ts";
import { installScript } from "../src/rules/install-script.ts";
import type { Finding, Report } from "../src/types.ts";

const scriptFinding: Finding = {
  ruleId: "DL001",
  ruleName: "install-script",
  severity: "low",
  package: { name: "native-addon", version: "3.1.0" },
  message: "Runs a script when it is installed",
  evidence: { hasInstallScript: true },
  via: ["my-app", "some-lib@2.0.0", "native-addon@3.1.0"],
};

const gitFinding: Finding = {
  ruleId: "DL002",
  ruleName: "unusual-source",
  severity: "medium",
  package: { name: "forked-lib", version: "1.4.0" },
  message: "Installed from a git repository: github:someone/forked-lib#4f2c1e9",
  evidence: { source: "git", resolved: "github:someone/forked-lib#4f2c1e9", integrity: "missing" },
  via: ["my-app", "forked-lib@1.4.0"],
};

const report: Report = { packageCount: 1204, findings: [gitFinding, scriptFinding] };

describe("formatText", () => {
  it("says so when there are no findings", () => {
    assert.equal(formatText({ packageCount: 1, findings: [] }), "deplens: no findings in 1 package\n");
  });

  it("summarises counts by severity, most severe first", () => {
    const firstLine = formatText(report).split("\n")[0];
    assert.equal(firstLine, "deplens: 2 findings in 1,204 packages (1 medium, 1 low)");
  });

  it("prints each rule's explanation once, followed by its findings", () => {
    const text = formatText({ packageCount: 2, findings: [scriptFinding, { ...scriptFinding, package: { name: "other", version: "1.0.0" } }] });
    assert.equal(text.match(/^ {2}why {2}/gm)?.length, 1);
    assert.match(text, /^ {2}LOW {5}native-addon@3\.1\.0$/m);
    assert.match(text, /^ {10}via my-app > some-lib@2\.0\.0 > native-addon@3\.1\.0$/m);
    assert.match(text, /^ {2}LOW {5}other@1\.0\.0$/m);
  });

  it("orders rule groups by their most severe finding", () => {
    const text = formatText(report);
    assert.ok(text.indexOf("DL002 unusual-source") < text.indexOf("DL001 install-script"));
  });

  it("wraps prose to 80 columns", () => {
    for (const line of formatText(report).split("\n")) {
      // A single word longer than the line, such as a URL, can't be wrapped.
      const isOneWord = !line.trim().includes(" ");
      assert.ok(line.length <= 80 || isOneWord, `line too long: ${line}`);
    }
  });
});

describe("formatJson", () => {
  it("includes counts, findings and each rule's explanation", () => {
    const output = JSON.parse(formatJson(report));
    assert.equal(output.schemaVersion, 1);
    assert.equal(output.packageCount, 1204);
    assert.deepEqual(output.summary, { low: 1, medium: 1, high: 0 });
    assert.deepEqual(output.findings[1], { ...scriptFinding, why: installScript.why, fix: installScript.fix });
  });
});
