import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unusualSource } from "../../src/rules/unusual-source.ts";
import type { PackageNode, RuleContext, Severity } from "../../src/types.ts";
import { defaultContext, pkg } from "../helpers.ts";

describe("DL002 unusual-source", () => {
  // Each case: a package, and the severity and evidence source expected
  // (or undefined when the rule should stay quiet).
  const cases: Array<{
    name: string;
    pkg: PackageNode;
    expected: { severity: Severity; source: string } | undefined;
  }> = [
    {
      name: "registry package with a hash",
      pkg: pkg(),
      expected: undefined,
    },
    {
      name: "registry package without a hash",
      pkg: pkg({ integrity: undefined }),
      expected: { severity: "high", source: "registry" },
    },
    {
      name: "no resolved URL but a hash (omit-lockfile-registry-resolved)",
      pkg: pkg({ resolved: undefined }),
      expected: undefined,
    },
    {
      name: "git+ssh URL",
      pkg: pkg({ resolved: "git+ssh://git@github.com/user/repo.git#abc123", integrity: undefined }),
      expected: { severity: "medium", source: "git" },
    },
    {
      name: "github: shorthand",
      pkg: pkg({ resolved: "github:user/repo#abc123", integrity: undefined }),
      expected: { severity: "medium", source: "git" },
    },
    {
      name: "plain http",
      pkg: pkg({ resolved: "http://registry.npmjs.org/some-lib/-/some-lib-1.0.0.tgz" }),
      expected: { severity: "high", source: "http" },
    },
    {
      name: "tarball on another host",
      pkg: pkg({ resolved: "https://example.com/some-lib-1.0.0.tgz" }),
      expected: { severity: "high", source: "other-host" },
    },
    {
      name: "local tarball",
      pkg: pkg({ resolved: "file:vendor/some-lib-1.0.0.tgz", integrity: undefined }),
      expected: undefined,
    },
    {
      name: "relative local path",
      pkg: pkg({ resolved: "../some-lib", integrity: undefined }),
      expected: undefined,
    },
    {
      name: "bundled package, which has no source of its own",
      pkg: pkg({ resolved: undefined, integrity: undefined, bundled: true }),
      expected: undefined,
    },
  ];

  for (const { name, pkg: input, expected } of cases) {
    it(name, () => {
      const match = unusualSource.check(input, defaultContext);
      if (expected === undefined) {
        assert.equal(match, undefined);
      } else {
        assert.equal(match?.severity, expected.severity);
        assert.equal(match?.evidence["source"], expected.source);
      }
    });
  }

  it("trusts registries passed in the context", () => {
    const ctx: RuleContext = { ...defaultContext, registryHosts: new Set(["npm.internal.example"]) };
    const internal = pkg({ resolved: "https://npm.internal.example/some-lib/-/some-lib-1.0.0.tgz" });
    assert.equal(unusualSource.check(internal, ctx), undefined);
    // The public registry is no longer trusted unless it's listed too.
    assert.equal(unusualSource.check(pkg(), ctx)?.evidence["source"], "other-host");
  });

  it("hides passwords embedded in URLs", () => {
    const match = unusualSource.check(
      pkg({ resolved: "https://user:s3cret@example.com/some-lib-1.0.0.tgz" }),
      defaultContext,
    );
    assert.ok(match);
    assert.doesNotMatch(match.message, /s3cret/);
    assert.doesNotMatch(String(match.evidence["resolved"]), /s3cret/);
  });
});
