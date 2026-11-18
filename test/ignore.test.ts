import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyIgnores } from "../src/ignore.ts";
import type { Finding } from "../src/types.ts";

function finding(ruleId: string, name: string, version = "1.0.0"): Finding {
  return {
    ruleId,
    ruleName: "test-rule",
    severity: "medium",
    package: { name, version },
    message: "flagged",
    evidence: {},
    via: ["my-app", `${name}@${version}`],
  };
}

const label = (f: Finding) => `${f.ruleId} ${f.package.name}@${f.package.version}`;

describe("applyIgnores", () => {
  const findings = [finding("DL001", "a"), finding("DL002", "a"), finding("DL001", "b", "2.0.0")];

  it("sets aside findings that match a rule and package, with the reason", () => {
    const { reported, ignored } = applyIgnores(findings, [{ rule: "DL001", package: "a", reason: "reviewed" }]);
    assert.deepEqual(reported.map(label), ["DL002 a@1.0.0", "DL001 b@2.0.0"]);
    assert.deepEqual(
      ignored.map((f) => `${label(f)}: ${f.ignoreReason}`),
      ["DL001 a@1.0.0: reviewed"],
    );
  });

  it("matches only the given version when there is one", () => {
    const pinned = [{ rule: "DL001", package: "b", version: "1.9.0", reason: "reviewed 1.9.0" }];
    assert.deepEqual(applyIgnores(findings, pinned).ignored, []);

    const current = [{ rule: "DL001", package: "b", version: "2.0.0", reason: "reviewed 2.0.0" }];
    assert.deepEqual(applyIgnores(findings, current).ignored.map(label), ["DL001 b@2.0.0"]);
  });

  it("matches every version when there is none", () => {
    const any = [{ rule: "DL001", package: "b", reason: "always fine" }];
    assert.deepEqual(applyIgnores([finding("DL001", "b", "9.9.9")], any).ignored.map(label), ["DL001 b@9.9.9"]);
  });

  it("never matches a different rule or package", () => {
    const { reported } = applyIgnores(findings, [{ rule: "DL002", package: "b", reason: "x" }]);
    assert.equal(reported.length, 3);
  });

  it("uses the first matching rule's reason", () => {
    const { ignored } = applyIgnores(
      [finding("DL001", "a")],
      [
        { rule: "DL001", package: "a", version: "1.0.0", reason: "first" },
        { rule: "DL001", package: "a", reason: "second" },
      ],
    );
    assert.equal(ignored[0]?.ignoreReason, "first");
  });
});
