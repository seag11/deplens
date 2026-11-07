/**
 * The analysis engine and deplens's main library entry point.
 *
 * analyze() parses a lockfile, runs every rule against every package, and
 * returns the findings in a stable order. It does no I/O of its own: the
 * caller reads files and decides what to do with the report, which lets the
 * CLI, a GitHub Action and tests all share the same engine.
 */

import { parseLockfile } from "./lockfile.ts";
import { RULES } from "./rules/index.ts";
import { severityRank } from "./severity.ts";
import type { Finding, Report, Rule, RuleContext } from "./types.ts";

/** The public npm registry, trusted unless other registries are given. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export interface AnalyzeInput {
  /** The text of a package-lock.json or npm-shrinkwrap.json. */
  readonly lockfile: string;
  /**
   * Registry URLs that packages may come from. Defaults to the public npm
   * registry. Pass every registry you use, including the public one if you
   * mix it with a private registry.
   */
  readonly registries?: readonly string[];
  /**
   * Popular package names, most popular first, for the typosquat check.
   * Defaults to none, which turns the check off.
   */
  readonly popularPackages?: readonly string[];
  /** The rules to run. Defaults to all of them; tests pass a subset. */
  readonly rules?: readonly Rule[];
}

/**
 * Analyzes a lockfile.
 *
 * @throws LockfileError if the lockfile can't be parsed.
 * @throws TypeError if a registry isn't a valid URL.
 */
export function analyze(input: AnalyzeInput): Report {
  const { packages } = parseLockfile(input.lockfile);
  const rules = input.rules ?? RULES;
  const ctx: RuleContext = {
    registryHosts: new Set((input.registries ?? [DEFAULT_REGISTRY]).map((url) => new URL(url).host)),
    popularPackages: new Set(input.popularPackages ?? []),
  };

  const findings: Finding[] = [];
  for (const pkg of packages) {
    for (const rule of rules) {
      const match = rule.check(pkg, ctx);
      if (match === undefined) continue;
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: match.severity,
        package: { name: pkg.name, version: pkg.version },
        message: match.message,
        evidence: match.evidence,
        via: pkg.path,
      });
    }
  }

  return { packageCount: packages.length, findings: findings.sort(compareFindings) };
}

/** Highest severity first, then by rule, then by package, so output is stable. */
function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.package.name.localeCompare(b.package.name) ||
    a.package.version.localeCompare(b.package.version)
  );
}
