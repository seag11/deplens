/**
 * Applies ignore rules to findings.
 *
 * Rules always report what they see; accepting a finding is a separate,
 * later step. Ignored findings aren't dropped: they are returned with the
 * reason, so every report shows what was accepted and why.
 */

import type { IgnoreRule } from "./config.ts";
import type { Finding, IgnoredFinding, PackageNode } from "./types.ts";

/**
 * Splits findings into those still reported and those an ignore rule accepts.
 * The first matching ignore rule supplies the reason. Order is preserved.
 */
export function applyIgnores(
  findings: readonly Finding[],
  ignores: readonly IgnoreRule[],
): { reported: Finding[]; ignored: IgnoredFinding[] } {
  const reported: Finding[] = [];
  const ignored: IgnoredFinding[] = [];

  for (const finding of findings) {
    const match = ignores.find((ignore) => matches(ignore, finding));
    if (match === undefined) reported.push(finding);
    else ignored.push({ ...finding, ignoreReason: match.reason });
  }

  return { reported, ignored };
}

/**
 * The ignore rules that match no package in the lockfile at all: a misspelt
 * name, a wrong version, or a package that has since been removed or
 * upgraded. Such a rule can never accept anything, so the user should know.
 *
 * This checks the whole lockfile, not just the findings, so it works when
 * only changed packages are checked: an ignore for an unchanged package
 * still matches a package here.
 */
export function unmatchedIgnores(ignores: readonly IgnoreRule[], packages: readonly PackageNode[]): IgnoreRule[] {
  return ignores.filter(
    (ignore) =>
      !packages.some(
        (pkg) => pkg.name === ignore.package && (ignore.version === undefined || pkg.version === ignore.version),
      ),
  );
}

function matches(ignore: IgnoreRule, finding: Finding): boolean {
  return (
    ignore.rule === finding.ruleId &&
    ignore.package === finding.package.name &&
    (ignore.version === undefined || ignore.version === finding.package.version)
  );
}
