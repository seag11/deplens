/** Builders that keep tests short: each test spells out only what it checks. */

import type { PackageNode, RuleContext } from "../src/types.ts";

/** A registry package with an integrity hash, which no rule flags. */
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

/** The context rules see by default: only the public npm registry is trusted. */
export const defaultContext: RuleContext = {
  registryHosts: new Set(["registry.npmjs.org"]),
};

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
