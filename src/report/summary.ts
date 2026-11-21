/**
 * What every report format shares: the one-sentence summary, severity
 * counts, and grouping findings by rule.
 *
 * Findings carry only a rule ID. Each format looks up the rule's explanation
 * and fix advice from the rule registry, so those are written once, in the
 * rule's own file.
 */

import { SEVERITIES, type Finding, type Report, type Severity } from "../types.ts";

/**
 * One sentence describing the result, such as
 * `2 findings in 412 packages (1 high, 1 low)`, or when comparing against a
 * base, `1 finding in 14 changed packages of 1,203 (1 high)`.
 */
export function summarize(report: Report): string {
  if (report.changedCount === 0) {
    return `no packages changed since the base (${formatCount(report.packageCount)} in total)`;
  }

  const scope =
    report.changedCount === undefined
      ? plural(report.packageCount, "package")
      : `${plural(report.changedCount, "changed package")} of ${formatCount(report.packageCount)}`;
  if (report.findings.length === 0) return `no findings in ${scope}`;

  const counts = countBySeverity(report.findings);
  const breakdown = [...SEVERITIES]
    .reverse()
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  return `${plural(report.findings.length, "finding")} in ${scope} (${breakdown})`;
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts = { low: 0, medium: 0, high: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Groups findings by rule. Findings arrive sorted with the most severe first,
 * so the groups come out ordered by their most severe finding.
 */
export function groupByRule(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.ruleId);
    if (group === undefined) groups.set(finding.ruleId, [finding]);
    else group.push(finding);
  }
  return groups;
}

/** `some-lib@1.4.2`. */
export function packageLabel(finding: Finding): string {
  return `${finding.package.name}@${finding.package.version}`;
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** 1204 → "1,204", the same in every locale so output is stable. */
function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
