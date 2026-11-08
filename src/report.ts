/**
 * Turns a Report into output for people (text) or programs (JSON).
 *
 * Findings carry only a rule ID. The explanation and fix advice are looked up
 * from the rule here, so each is written once in the rule's own file.
 */

import { findRule } from "./rules/index.ts";
import { SEVERITIES, type Finding, type Report, type Severity } from "./types.ts";

/** Text output wraps prose at this width. */
const WIDTH = 80;

/**
 * Formats a report for a terminal or CI log.
 *
 * Findings are grouped by rule so that each rule's explanation is printed
 * once, followed by the packages it matched:
 *
 *   deplens: 2 findings in 412 packages (1 high, 1 low)
 *
 *   DL002 unusual-source
 *     why  A version published to the npm registry can never be changed...
 *     fix  Depend on a version published to the registry if one exists...
 *
 *     HIGH    left-pad@1.3.0
 *             Downloaded over unencrypted http: http://example.com/...
 *             via my-app > some-lib@2.0.0 > left-pad@1.3.0
 */
export function formatText(report: Report): string {
  const lines = [summaryLine(report)];

  for (const [ruleId, findings] of groupByRule(report.findings)) {
    const rule = findRule(ruleId);
    lines.push("", `${ruleId} ${findings[0]?.ruleName ?? ""}`);
    if (rule !== undefined) {
      lines.push(...labelled("why", rule.why), ...labelled("fix", rule.fix));
    }
    for (const finding of findings) {
      lines.push(
        "",
        `  ${finding.severity.toUpperCase().padEnd(6)}  ${finding.package.name}@${finding.package.version}`,
        ...wrap(finding.message, " ".repeat(10)),
        ...wrap(`via ${finding.via.join(" > ")}`, " ".repeat(10)),
      );
    }
  }

  // Warnings go last, where they are seen after the findings, and in the
  // clean case directly under the summary.
  if (report.warnings.length > 0) lines.push("");
  for (const warning of report.warnings) {
    const [first = "", ...rest] = wrap(warning, " ".repeat(6));
    lines.push(`note  ${first.trimStart()}`, ...rest);
  }

  return lines.join("\n") + "\n";
}

/**
 * Formats a report as JSON. Each finding includes its rule's explanation, so
 * consumers don't need to know the rules. `schemaVersion` changes only when
 * the shape changes in a way that could break a consumer.
 */
export function formatJson(report: Report): string {
  const output = {
    schemaVersion: 1,
    packageCount: report.packageCount,
    summary: countBySeverity(report.findings),
    findings: report.findings.map((finding) => {
      const rule = findRule(finding.ruleId);
      return { ...finding, why: rule?.why, fix: rule?.fix };
    }),
    warnings: report.warnings,
  };
  return JSON.stringify(output, null, 2) + "\n";
}

function summaryLine(report: Report): string {
  const packages = plural(report.packageCount, "package");
  if (report.findings.length === 0) return `deplens: no findings in ${packages}`;

  const counts = countBySeverity(report.findings);
  const breakdown = [...SEVERITIES]
    .reverse()
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
  return `deplens: ${plural(report.findings.length, "finding")} in ${packages} (${breakdown})`;
}

function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts = { low: 0, medium: 0, high: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Groups findings by rule. Findings arrive sorted with the most severe first,
 * so the groups come out ordered by their most severe finding.
 */
function groupByRule(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.ruleId);
    if (group === undefined) groups.set(finding.ruleId, [finding]);
    else group.push(finding);
  }
  return groups;
}

/** A labelled, wrapped paragraph: `  why  first line` with aligned continuation lines. */
function labelled(label: string, text: string): string[] {
  const [first = "", ...rest] = wrap(text, " ".repeat(7));
  return [`  ${label}  ${first.trimStart()}`, ...rest];
}

/** Wraps text to WIDTH, prefixing every line with `indent`. */
function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line !== "" && indent.length + line.length + 1 + word.length > WIDTH) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(indent + line);
  return lines;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}
