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

import { findRule } from "../rules/index.ts";
import type { Report } from "../types.ts";
import { printable } from "./printable.ts";
import { groupByRule, packageLabel, summarize } from "./summary.ts";

/** Prose is wrapped at this width. */
const WIDTH = 80;

/**
 * Every value from outside deplens (package names and versions, dependency
 * paths, messages that quote scripts or publishers, ignore reasons, warnings)
 * goes through printable(), so it can't send escape sequences to the
 * terminal or rearrange how a line displays.
 */
export function formatText(report: Report): string {
  const lines = [`deplens: ${summarize(report)}`];

  for (const [ruleId, findings] of groupByRule(report.findings)) {
    const rule = findRule(ruleId);
    lines.push("", `${ruleId} ${findings[0]?.ruleName ?? ""}`);
    if (rule !== undefined) {
      lines.push(...labelled("why", rule.why), ...labelled("fix", rule.fix));
    }
    for (const finding of findings) {
      lines.push(
        "",
        `  ${finding.severity.toUpperCase().padEnd(6)}  ${printable(packageLabel(finding))}`,
        ...wrap(printable(finding.message), " ".repeat(10)),
        ...wrap(`via ${finding.via.map(printable).join(" > ")}`, " ".repeat(10)),
      );
    }
  }

  // Accepted findings are listed, with their reasons, so nothing is hidden.
  if (report.ignored.length > 0) lines.push("");
  for (const finding of report.ignored) {
    const accepted = `${finding.ruleId} ${printable(packageLabel(finding))}: ${printable(finding.ignoreReason)}`;
    const [first = "", ...rest] = wrap(accepted, " ".repeat(9));
    lines.push(`ignored  ${first.trimStart()}`, ...rest);
  }

  // Warnings go last, where they are seen after the findings, and in the
  // clean case directly under the summary.
  if (report.warnings.length > 0) lines.push("");
  for (const warning of report.warnings) {
    const [first = "", ...rest] = wrap(printable(warning), " ".repeat(6));
    lines.push(`note  ${first.trimStart()}`, ...rest);
  }

  return lines.join("\n") + "\n";
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
