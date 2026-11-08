/**
 * End-to-end scenarios: one per attack shape seen in real npm compromises,
 * plus a legitimate change that must stay quiet.
 *
 * Each scenario records which rules fire and whether CI fails at the default
 * threshold (`--fail-on high`) and at the threshold recommended for pull
 * requests (`--fail-on medium`). Together they document what deplens catches
 * and, just as importantly, what it doesn't.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import type { Packument } from "../src/packument.ts";
import { isAtLeast } from "../src/severity.ts";
import { daysAgo, fakeRegistry, hoursAgo, lockfileText, NOW, packumentOf, registryEntry, version } from "./helpers.ts";

interface Outcome {
  /** "RULE severity package", sorted. */
  readonly findings: string[];
  readonly failsAtHigh: boolean;
  readonly failsAtMedium: boolean;
}

async function scenario(options: {
  lockfile: Record<string, unknown>;
  packuments?: Packument[];
  popularPackages?: string[];
}): Promise<Outcome> {
  const report = await analyze({
    lockfile: lockfileText(options.lockfile),
    registry: fakeRegistry(options.packuments ?? []).client,
    now: NOW,
    popularPackages: options.popularPackages ?? [],
  });
  return {
    findings: report.findings.map((f) => `${f.ruleId} ${f.severity} ${f.package.name}`).sort(),
    failsAtHigh: report.findings.some((f) => isAtLeast(f.severity, "high")),
    failsAtMedium: report.findings.some((f) => isAtLeast(f.severity, "medium")),
  };
}

const trustedCi = { publisher: { name: "GitHub Actions", trusted: true }, hasProvenance: true };
const maintainer = { publisher: { name: "maintainer", trusted: false } };
const postinstall = { installScripts: { postinstall: "node setup.js" } };

describe("attack shapes", () => {
  it("a stolen token publishes a patch that adds an install script, without provenance", async () => {
    // The project publishes from CI with provenance. The attacker publishes
    // from their own machine as the real maintainer, adding a postinstall.
    const outcome = await scenario({
      lockfile: { "node_modules/some-lib": registryEntry("some-lib", "1.4.2", { hasInstallScript: true }) },
      packuments: [
        packumentOf("some-lib", [
          version("1.3.0", { ...maintainer, publishedAt: daysAgo(120) }),
          version("1.4.0", { ...trustedCi, publishedAt: daysAgo(60) }),
          version("1.4.1", { ...trustedCi, publishedAt: daysAgo(30) }),
          version("1.4.2", { ...maintainer, ...postinstall, publishedAt: hoursAgo(5) }),
        ]),
      ],
    });
    assert.deepEqual(outcome, {
      findings: ["DL001 high some-lib", "DL004 medium some-lib", "DL006 high some-lib"],
      failsAtHigh: true,
      failsAtMedium: true,
    });
  });

  it("a hijacked CI workflow publishes with valid provenance and a new install script", async () => {
    // Provenance can't help here: the release really did come from the
    // project's CI. The new script on a fresh version still stands out.
    const outcome = await scenario({
      lockfile: { "node_modules/some-lib": registryEntry("some-lib", "3.2.1", { hasInstallScript: true }) },
      packuments: [
        packumentOf("some-lib", [
          version("3.2.0", { ...trustedCi, publishedAt: daysAgo(20) }),
          version("3.2.1", { ...trustedCi, ...postinstall, publishedAt: hoursAgo(2) }),
        ]),
      ],
    });
    assert.deepEqual(outcome, {
      findings: ["DL001 high some-lib", "DL004 medium some-lib"],
      failsAtHigh: true,
      failsAtMedium: true,
    });
  });

  it("a phished maintainer publishes a payload in the library code, with no install script", async () => {
    // Same publisher, no install script, no provenance before or after. Only
    // the release's age gives it away, which is why pull requests should use
    // --fail-on medium.
    const outcome = await scenario({
      lockfile: { "node_modules/some-lib": registryEntry("some-lib", "4.0.1") },
      packuments: [
        packumentOf("some-lib", [
          version("4.0.0", { ...maintainer, publishedAt: daysAgo(200) }),
          version("4.0.1", { ...maintainer, publishedAt: hoursAgo(4) }),
        ]),
      ],
    });
    assert.deepEqual(outcome, {
      findings: ["DL004 medium some-lib"],
      failsAtHigh: false,
      failsAtMedium: true,
    });
  });

  it("a new release adds a typosquatted dependency", async () => {
    const outcome = await scenario({
      lockfile: {
        "": { name: "my-app", dependencies: { "some-lib": "^2" } },
        "node_modules/some-lib": registryEntry("some-lib", "2.0.1", { dependencies: { widgetkit: "^1" } }),
        "node_modules/widgetkit": registryEntry("widgetkit", "1.0.0"),
      },
      packuments: [
        packumentOf("some-lib", [
          version("2.0.0", { ...maintainer, publishedAt: daysAgo(40) }),
          version("2.0.1", { ...maintainer, publishedAt: hoursAgo(6) }),
        ]),
        packumentOf("widgetkit", [version("1.0.0", { publishedAt: daysAgo(1) })]),
      ],
      popularPackages: ["widget-kit"],
    });
    assert.deepEqual(outcome, {
      findings: ["DL003 high widgetkit", "DL004 medium some-lib", "DL004 medium widgetkit"],
      failsAtHigh: true,
      failsAtMedium: true,
    });
  });

  it("a dependency is installed from a git repository", async () => {
    const outcome = await scenario({
      lockfile: { "node_modules/forked-lib": { version: "1.0.0", resolved: "github:someone/forked-lib#4f2c1e9" } },
    });
    assert.deepEqual(outcome, {
      findings: ["DL002 medium forked-lib"],
      failsAtHigh: false,
      failsAtMedium: true,
    });
  });
});

describe("legitimate changes that must stay quiet", () => {
  it("a project switches to trusted publishing", async () => {
    // New publisher identity and newly added provenance: both improvements.
    const outcome = await scenario({
      lockfile: { "node_modules/some-lib": registryEntry("some-lib", "5.1.0") },
      packuments: [
        packumentOf("some-lib", [
          version("5.0.0", { ...maintainer, publishedAt: daysAgo(90) }),
          version("5.1.0", { ...trustedCi, publishedAt: daysAgo(10) }),
        ]),
      ],
    });
    assert.deepEqual(outcome, { findings: [], failsAtHigh: false, failsAtMedium: false });
  });

  it("a native addon releases an update with the same install script", async () => {
    const outcome = await scenario({
      lockfile: { "node_modules/native-addon": registryEntry("native-addon", "2.1.0", { hasInstallScript: true }) },
      packuments: [
        packumentOf("native-addon", [
          version("2.0.0", { ...trustedCi, ...postinstall, publishedAt: daysAgo(90) }),
          version("2.1.0", { ...trustedCi, ...postinstall, publishedAt: daysAgo(14) }),
        ]),
      ],
    });
    assert.deepEqual(outcome, {
      findings: ["DL001 low native-addon"],
      failsAtHigh: false,
      failsAtMedium: false,
    });
  });
});
