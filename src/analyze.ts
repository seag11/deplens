/**
 * The analysis engine and deplens's main library entry point.
 *
 * analyze() parses a lockfile, optionally narrows it to the packages that
 * changed since a base lockfile, fetches registry metadata for the packages
 * that came from a registry, runs every rule against every package, sets
 * aside findings the configuration accepts, and returns the rest in a stable
 * order.
 *
 * It reads no files and never touches the network directly: the caller
 * passes in the lockfile text and, to go online, a RegistryClient. That lets
 * the CLI, a GitHub Action and tests all share the same engine.
 */

import type { IgnoreRule } from "./config.ts";
import { changedPackages } from "./diff.ts";
import { applyIgnores } from "./ignore.ts";
import { LockfileError, parseLockfile } from "./lockfile.ts";
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
   * A base to compare against, such as the lockfile on the target branch of
   * a pull request. When given, only packages that are new or changed since
   * the base are checked. `lockfile` is undefined when the base had no
   * lockfile, which makes every package new.
   */
  readonly base?: { readonly lockfile: string | undefined };
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
  /**
   * Findings to accept, usually from `.deplens.json`. Accepted findings are
   * moved to the report's `ignored` list instead of being dropped.
   */
  readonly ignore?: readonly IgnoreRule[];
  /** The rules to run. Defaults to all of them; tests pass a subset. */
  readonly rules?: readonly Rule[];
}

/**
 * Analyzes a lockfile.
 *
 * Registry failures don't fail the analysis: the affected packages are
 * checked without registry metadata and the report's warnings list them.
 *
 * @throws LockfileError if the lockfile or the base lockfile can't be parsed.
 * @throws TypeError if a registry isn't a valid URL.
 */
export async function analyze(input: AnalyzeInput): Promise<Report> {
  const all = parseLockfile(input.lockfile).packages;
  const rules = input.rules ?? RULES;
  const registries = input.registries ?? [DEFAULT_REGISTRY];
  const registryHosts = new Set(registries.map((url) => new URL(url).host));
  const warnings: string[] = [];

  // With a base, everything below (registry requests included) only sees
  // the packages that changed.
  let packages = all;
  if (input.base !== undefined) {
    if (input.base.lockfile === undefined) {
      warnings.push("The base had no lockfile, so every package counts as new.");
    } else {
      packages = changedPackages(all, parseBaseLockfile(input.base.lockfile));
    }
  }

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

  // Ignores are applied last, so rules never need to know about them.
  const { reported, ignored } = applyIgnores(findings.sort(compareFindings), input.ignore ?? []);

  return {
    packageCount: all.length,
    ...(input.base !== undefined ? { changedCount: packages.length } : {}),
    findings: reported,
    ignored,
    warnings,
  };
}

/** Parses the base lockfile, saying which lockfile is at fault if it can't be read. */
function parseBaseLockfile(text: string): readonly PackageNode[] {
  try {
    return parseLockfile(text).packages;
  } catch (error) {
    if (error instanceof LockfileError) throw new LockfileError(`The base lockfile can't be read: ${error.message}`);
    throw error;
  }
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
