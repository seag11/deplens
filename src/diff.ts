/**
 * Compares two lockfiles' packages, to scan only what a change introduced.
 *
 * In CI the question is "what did this pull request add?", not "is the whole
 * tree perfect?". Scanning only new and changed packages keeps findings
 * relevant to the change, and keeps registry requests to a handful.
 */

import type { PackageNode } from "./types.ts";

/**
 * The packages in `head` that are new or changed compared with `base`.
 *
 * A package counts as changed when its name and version weren't in the base,
 * or when its source or integrity hash differs from the base's copy of the
 * same version. The same version from a different source, or with a
 * different hash, is a different download, and possibly a tampered one.
 * Packages removed since the base are ignored: removing code adds no risk.
 */
export function changedPackages(
  head: readonly PackageNode[],
  base: readonly PackageNode[],
): PackageNode[] {
  const inBase = new Set(base.map(identity));
  return head.filter((pkg) => !inBase.has(identity(pkg)));
}

/** What makes two installed packages the same download. */
function identity(pkg: PackageNode): string {
  // NUL can't appear in any of these fields, so the key is unambiguous.
  return [pkg.name, pkg.version, pkg.resolved ?? "", pkg.integrity ?? ""].join("\0");
}
