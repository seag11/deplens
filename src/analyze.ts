/**
 * The analysis engine and deplens's main library entry point.
 *
 * analyze() parses a lockfile, fetches registry metadata for the packages
 * that came from a registry, runs every rule against every package, and
 * returns the findings in a stable order.
 *
 * It reads no files and never touches the network directly: the caller
 * passes in the lockfile text and, to go online, a RegistryClient. That lets
 * the CLI, a GitHub Action and tests all share the same engine.
 */

import { parseLockfile } from "./lockfile.ts";
import type { Packument } from "./packument.ts";
import type { RegistryClient } from "./registry.ts";
import { RULES } from "./rules/index.ts";
import { severityRank } from "./severity.ts";
import { classifySource } from "./source.ts";
import type { Finding, PackageNode, Report, Rule, RuleContext } from "./types.ts";

/** The public npm registry, trusted unless other registries are given. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

/** At most this many package names are listed in a warning. */
const MAX_NAMES_IN_WARNING = 5;

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
   * Where to fetch registry metadata. Without one, the analysis is offline:
   * rules that need the registry are skipped and a warning says so.
   */
  readonly registry?: RegistryClient;
  /** The time to judge release ages against. Defaults to now. */
  readonly now?: Date;
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
 * Registry failures don't fail the analysis: the affected packages are
 * checked without registry metadata and the report's warnings list them.
 *
 * @throws LockfileError if the lockfile can't be parsed.
 * @throws TypeError if a registry isn't a valid URL.
 */
export async function analyze(input: AnalyzeInput): Promise<Report> {
  const { packages } = parseLockfile(input.lockfile);
  const rules = input.rules ?? RULES;
  const registries = input.registries ?? [DEFAULT_REGISTRY];
  const registryHosts = new Set(registries.map((url) => new URL(url).host));
  const warnings: string[] = [];

  let packuments = new Map<string, Packument>();
  if (input.registry === undefined) {
    const skipped = rules.filter((rule) => rule.needsRegistry);
    if (skipped.length > 0) {
      warnings.push(`Offline: skipped ${skipped.map((rule) => `${rule.id} ${rule.name}`).join(", ")}.`);
    }
  } else {
    const fetched = await fetchPackuments(packages, registries, registryHosts, input.registry);
    packuments = fetched.packuments;
    if (fetched.missing.length > 0) warnings.push(missingWarning(fetched.missing));
  }

  const shared = {
    now: input.now ?? new Date(),
    registryHosts,
    popularPackages: new Set(input.popularPackages ?? []),
  };

  const findings: Finding[] = [];
  for (const pkg of packages) {
    const ctx: RuleContext = { ...shared, packument: packuments.get(pkg.name) };
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

  return { packageCount: packages.length, findings: findings.sort(compareFindings), warnings };
}

/**
 * Fetches one packument per package name, for the packages that came from a
 * registry. Each is fetched from the registry the package was downloaded
 * from, or from the first configured registry if the lockfile doesn't say.
 *
 * Returns the packuments by name, and the names whose metadata couldn't be
 * fetched (an error, or a package the registry doesn't know).
 */
async function fetchPackuments(
  packages: readonly PackageNode[],
  registries: readonly string[],
  registryHosts: ReadonlySet<string>,
  client: RegistryClient,
): Promise<{ packuments: Map<string, Packument>; missing: string[] }> {
  const urlByHost = new Map(registries.map((url) => [new URL(url).host, url]));
  const defaultRegistry = registries[0] ?? DEFAULT_REGISTRY;

  // Name → registry URL. Bundled packages and non-registry sources (git,
  // local folders, other hosts) have no registry metadata to fetch.
  const toFetch = new Map<string, string>();
  for (const pkg of packages) {
    const source = classifySource(pkg.resolved, registryHosts);
    if (pkg.bundled || source.kind !== "registry" || toFetch.has(pkg.name)) continue;
    toFetch.set(pkg.name, (source.host && urlByHost.get(source.host)) ?? defaultRegistry);
  }

  const requests = [...toFetch];
  const results = await Promise.allSettled(requests.map(([name, url]) => client.packument(name, url)));

  const packuments = new Map<string, Packument>();
  const missing: string[] = [];
  requests.forEach(([name], index) => {
    const result = results[index];
    if (result?.status === "fulfilled" && result.value !== undefined) packuments.set(name, result.value);
    else missing.push(name);
  });

  return { packuments, missing: missing.sort() };
}

function missingWarning(names: readonly string[]): string {
  const listed = names.slice(0, MAX_NAMES_IN_WARNING).join(", ");
  const more = names.length > MAX_NAMES_IN_WARNING ? ` and ${names.length - MAX_NAMES_IN_WARNING} more` : "";
  const subject = names.length === 1 ? "1 package" : `${names.length} packages`;
  return `Couldn't get registry metadata for ${subject} (${listed}${more}); registry checks were skipped for them.`;
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
