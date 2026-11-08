/**
 * DL002 unusual-source: the package doesn't come from a trusted registry with
 * an integrity hash.
 *
 * Works offline from the lockfile's `resolved` and `integrity` fields. At most
 * one match is reported per package, for the most serious problem, so that a
 * single bad source produces a single finding.
 */

import { classifySource } from "../source.ts";
import type { Match, Rule } from "../types.ts";

export const unusualSource: Rule = {
  id: "DL002",
  name: "unusual-source",
  needsRegistry: false,

  why:
    "A version published to the npm registry can never be changed, and npm " +
    "checks every download against the integrity hash in the lockfile. Other " +
    "sources lose some of that protection. Git dependencies have no integrity " +
    "hash, and npm runs their `prepare` script while installing them. A " +
    "download over plain http can be altered in transit. A tarball on " +
    "another server can be replaced by whoever controls that server. Without " +
    "an integrity hash, npm can't detect tampering at all.",

  fix:
    "Depend on a version published to the registry if one exists. If you use " +
    "a private registry, pass it to deplens with `--registry`. If the source " +
    "is intentional, review what it points to and keep it pinned to an exact " +
    "commit or file.",

  check(pkg, ctx): Match | undefined {
    // Bundled packages ship inside their parent's tarball, which is checked
    // as a package of its own, so they have no source of their own to check.
    if (pkg.bundled) return undefined;

    const integrity = pkg.integrity === undefined ? "missing" : "present";
    const source = classifySource(pkg.resolved, ctx.registryHosts);

    switch (source.kind) {
      case "local":
        // A local folder or tarball is part of the project and is reviewed
        // with it, so it isn't a supply chain source.
        return undefined;

      case "git":
        return {
          severity: "medium",
          message: `Installed from a git repository: ${source.url}`,
          evidence: { source: "git", resolved: source.url, integrity },
        };

      case "insecure":
        return {
          severity: "high",
          message: `Downloaded over unencrypted http: ${source.url}`,
          evidence: { source: "http", resolved: source.url, integrity },
        };

      case "other-host":
        return {
          severity: "high",
          message: `Downloaded from ${source.host}, which isn't a configured registry`,
          evidence: { source: "other-host", host: source.host, resolved: source.url, integrity },
        };

      case "registry":
        if (pkg.integrity !== undefined) return undefined;
        return {
          severity: "high",
          message: "Has no integrity hash, so npm can't verify the download",
          evidence: { source: "registry", integrity },
        };
    }
  },
};
