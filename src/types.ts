/**
 * Core types shared by every part of deplens.
 *
 * This module holds no logic and imports nothing, so the parser, the rules,
 * the reporters and the CLI can all depend on it without depending on each
 * other.
 */

/**
 * How much a finding matters, lowest first. The order is significant:
 * `--fail-on` and the reporters compare severities by their position here.
 */
export const SEVERITIES = ["low", "medium", "high"] as const;

export type Severity = (typeof SEVERITIES)[number];

/**
 * One installed package, as recorded in the lockfile.
 *
 * A lockfile can install the same name and version in several places in
 * `node_modules`. The parser merges those into a single node, so each
 * package is checked and reported once.
 */
export interface PackageNode {
  /**
   * The package's real name. For an alias such as
   * `"my-alias": "npm:real-name@1.0.0"` this is `real-name`, because that is
   * the code that actually gets installed.
   */
  readonly name: string;
  readonly version: string;
  /** Where npm downloaded it from: a registry URL, git URL or local path. */
  readonly resolved: string | undefined;
  /** Subresource Integrity hash of the tarball, such as `sha512-...`. */
  readonly integrity: string | undefined;
  /** npm marks packages with preinstall, install or postinstall scripts. */
  readonly hasInstallScript: boolean;
  /** True when the package is only needed for development. */
  readonly dev: boolean;
  /**
   * True when the package ships inside its parent's tarball
   * (`bundleDependencies`) instead of being downloaded on its own.
   */
  readonly bundled: boolean;
  /**
   * The shortest chain of packages that pulls this one in, starting with the
   * project and ending with this package, for example
   * `["my-app", "some-lib@3.1.0", "example-utils@2.4.1"]`.
   */
  readonly path: readonly string[];
}

/** A parsed lockfile. */
export interface Lockfile {
  /** The project's own name, used as the first entry of every path. */
  readonly rootName: string;
  readonly packages: readonly PackageNode[];
}

/**
 * Settings that rules read. They live in one object so that new settings
 * don't change any rule's signature.
 */
export interface RuleContext {
  /**
   * Hostnames that packages may be downloaded from, such as
   * `registry.npmjs.org`. Anything else counts as an unusual source.
   */
  readonly registryHosts: ReadonlySet<string>;
  /**
   * Names of widely used packages, most popular first. Typosquats are
   * recognised by how closely they resemble these names.
   */
  readonly popularPackages: ReadonlySet<string>;
}

/**
 * What a rule reports when it fires. The engine adds the rule's identity,
 * the package and the dependency path, so rules only describe what they saw.
 */
export interface Match {
  readonly severity: Severity;
  /** One line describing this specific case, with the concrete values. */
  readonly message: string;
  /** The facts that made the rule fire, for JSON output and debugging. */
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

/**
 * A single risk check.
 *
 * Rules must be pure: no network, no file system, no clock. Everything a rule
 * needs arrives through its arguments, which keeps rules deterministic and
 * lets each one be tested with plain objects.
 */
export interface Rule {
  /** Stable identifier such as `DL001`. Never reused or renumbered. */
  readonly id: string;
  /** Short kebab-case name such as `install-script`. */
  readonly name: string;
  /** Why this signal matters. Written once here and shown with findings. */
  readonly why: string;
  /** What to do about it. */
  readonly fix: string;
  /** Returns a match when the package shows this signal. */
  check(pkg: PackageNode, ctx: RuleContext): Match | undefined;
}

/** A rule match attached to the package it was found in. */
export interface Finding {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly package: { readonly name: string; readonly version: string };
  readonly message: string;
  readonly evidence: Match["evidence"];
  /** The dependency path that pulled the package in. */
  readonly via: readonly string[];
}

/** The result of one analysis. */
export interface Report {
  /** Number of distinct packages checked. */
  readonly packageCount: number;
  /** Findings ordered by severity (highest first), then rule, then package. */
  readonly findings: readonly Finding[];
}
