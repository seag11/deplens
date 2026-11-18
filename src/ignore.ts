/**
 * Applies ignore rules to findings.
 *
 * Rules always report what they see; accepting a finding is a separate,
 * later step. Ignored findings aren't dropped: they are returned with the
 * reason, so every report shows what was accepted and why.
 */

import type { IgnoreRule } from "./config.ts";
import type { Finding, IgnoredFinding } from "./types.ts";

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

function matches(ignore: IgnoreRule, finding: Finding): boolean {
  return (
    ignore.rule === finding.ruleId &&
    ignore.package === finding.package.name &&
    (ignore.version === undefined || ignore.version === finding.package.version)
  );
}
