/** Builders that keep tests short: each test spells out only what it checks. */

import type { Packument, VersionInfo } from "../src/packument.ts";
import type { RegistryClient } from "../src/registry.ts";
import type { PackageNode, RuleContext } from "../src/types.ts";

/** The fixed "now" for every test that involves release ages. */
export const NOW = new Date("2026-06-01T12:00:00Z");

/** A date the given number of hours before NOW. */
export function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

/** A date the given number of days before NOW. */
export function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}

/** A registry package with an integrity hash, which no offline rule flags. */
export function pkg(overrides: Partial<PackageNode> = {}): PackageNode {
  const name = overrides.name ?? "some-lib";
  const version = overrides.version ?? "1.0.0";
  return {
    name,
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    integrity: "sha512-AAAA",
    hasInstallScript: false,
    dev: false,
    bundled: false,
    path: ["my-app", `${name}@${version}`],
    ...overrides,
  };
}

/**
 * The context rules see by default: only the public npm registry is trusted,
 * there are no popular packages to compare names against, and no registry
 * metadata (as when offline).
 */
export const defaultContext: RuleContext = {
  now: NOW,
  packument: undefined,
  registryHosts: new Set(["registry.npmjs.org"]),
  popularPackages: new Set(),
};

/**
 * One version's registry metadata. By default: published 30 days ago by
 * "maintainer", with no install script and no provenance, so no rule flags it.
 */
export function version(version: string, overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    version,
    publishedAt: daysAgo(30),
    publisher: { name: "maintainer", trusted: false },
    installScripts: {},
    buildsNativeAddon: false,
    hasProvenance: false,
    ...overrides,
  };
}

/** A packument with the given versions, sorted oldest first as the parser does. */
export function packumentOf(name: string, versions: readonly VersionInfo[]): Packument {
  const time = (info: VersionInfo) => info.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return { name, versions: [...versions].sort((a, b) => time(a) - time(b)) };
}

/** A context with registry metadata for the package under test. */
export function withPackument(packument: Packument): RuleContext {
  return { ...defaultContext, packument };
}

/**
 * A RegistryClient that serves packuments from memory. Names listed in
 * `failing` reject, like a registry that can't be reached; unknown names
 * resolve to undefined, like a 404. Every request is recorded.
 */
export function fakeRegistry(packuments: readonly Packument[], failing: readonly string[] = []) {
  const byName = new Map(packuments.map((p) => [p.name, p]));
  const requests: Array<{ name: string; registryUrl: string }> = [];
  const client: RegistryClient = {
    async packument(name, registryUrl) {
      requests.push({ name, registryUrl });
      if (failing.includes(name)) throw new Error(`fake failure for ${name}`);
      return byName.get(name);
    },
  };
  return { client, requests };
}

/**
 * Builds the text of a lockfileVersion 3 file from its `packages` map. The
 * root entry ("") is added unless the map provides one.
 */
export function lockfileText(packages: Record<string, unknown>, name = "my-app"): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name, version: "1.0.0" }, ...packages },
  });
}

/** A registry entry for the `packages` map of a lockfile. */
export function registryEntry(name: string, version: string, extra: object = {}): object {
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    integrity: "sha512-AAAA",
    ...extra,
  };
}
