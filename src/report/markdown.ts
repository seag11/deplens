/**
 * Formats a report as Markdown, for places that render it: a GitHub job
 * summary, or a comment on a GitHub, GitLab or Bitbucket pull request.
 *
 *   ### deplens
 *
 *   2 findings in 14 changed packages of 412 (1 high, 1 low)
 *
 *   | Severity | Rule | Package | Finding |
 *   | --- | --- | --- | --- |
 *   | **HIGH** | DL001 install-script | some-lib@1.4.2 | Runs postinstall ...<br>via my-app › ... |
 *
 *   <details><summary>About these checks</summary> ... why and fix per rule ... </details>
 *
 * Much of a report comes from outside deplens: package names and versions
 * from the lockfile (which a pull request can change), script commands and
 * publisher names from the registry (which anyone can publish to), and ignore
 * reasons from .deplens.json. Two protections apply to all of it:
 *
 *   - escaping: every such value goes through escapeMarkdown(), so it renders
 *     as plain text instead of becoming a link, an image or HTML. Only
 *     deplens's own text (headings, rule explanations) is written as Markdown.
 *   - size limits: each value is cut to a maximum length, and each section
 *     has a byte budget, so a crafted lockfile can't produce a report that is
 *     too large to display. GitHub rejects job summaries over 1 MiB.
 */

import { findRule } from "../rules/index.ts";
import type { Finding, Report } from "../types.ts";
import { printable } from "./printable.ts";
import { groupByRule, packageLabel, summarize } from "./summary.ts";

/** Longest value from outside deplens that is shown, in characters. */
const MAX_VALUE_CHARS = 500;

/**
 * Byte budgets for the sections that grow with the input. Together with the
 * fixed parts (heading, summary, rule explanations) they stay well under
 * GitHub's 1 MiB limit for a job summary.
 */
const BUDGET_BYTES = { findings: 700_000, accepted: 150_000, notes: 100_000 };

const encoder = new TextEncoder();

export function formatMarkdown(report: Report): string {
  const lines = ["### deplens", "", capitalize(summarize(report))];

  if (report.findings.length > 0) {
    const rows = withinBudget(
      report.findings.map(row),
      BUDGET_BYTES.findings,
      (count) => `| … | | | ${count} more ${plural(count, "finding")} not shown here, to keep this report within size limits. The command's output lists them all. |`,
    );
    lines.push("", "| Severity | Rule | Package | Finding |", "| --- | --- | --- | --- |", ...rows);
    lines.push("", ...ruleDetails(report.findings));
  }

  if (report.ignored.length > 0) {
    const accepted = withinBudget(
      report.ignored.map((finding) => `- ${finding.ruleId} ${value(packageLabel(finding))}: ${value(finding.ignoreReason)}`),
      BUDGET_BYTES.accepted,
      (count) => `- …and ${count} more accepted ${plural(count, "finding")}, listed in the command's output.`,
    );
    lines.push("", "**Accepted findings** (not counted)", "", ...accepted);
  }

  if (report.warnings.length > 0) {
    const notes = withinBudget(
      report.warnings.map((warning) => `- ${value(warning)}`),
      BUDGET_BYTES.notes,
      (count) => `- …and ${count} more ${plural(count, "note")}, listed in the command's output.`,
    );
    lines.push("", "**Notes**", "", ...notes);
  }

  return lines.join("\n") + "\n";
}

/**
 * Escapes text so Markdown shows it literally.
 *
 * printable() first makes control and invisible characters visible. Then
 * every ASCII punctuation character is backslash-escaped: CommonMark allows
 * that for all of them, which rules out every construct (links, images,
 * emphasis, HTML, table cell breaks) without having to list them. Remaining
 * runs of whitespace become single spaces.
 *
 * GitHub can still turn a bare URL into a link, but only ever showing the
 * URL itself as the link text, so it can't be disguised as something else.
 */
export function escapeMarkdown(text: string): string {
  return printable(text)
    .replace(/\s+/g, " ")
    .replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/** An outside value, shortened if it's very long, then escaped. */
function value(text: string): string {
  // Count code points, not UTF-16 units, so a character is never cut in half.
  const chars = [...text];
  return escapeMarkdown(chars.length > MAX_VALUE_CHARS ? `${chars.slice(0, MAX_VALUE_CHARS).join("")}…` : text);
}

/** One table row. The dependency path goes on a second line in the same cell. */
function row(finding: Finding): string {
  const via = finding.via.map(value).join(" › ");
  const cells = [
    `**${finding.severity.toUpperCase()}**`,
    `${finding.ruleId} ${finding.ruleName}`,
    value(packageLabel(finding)),
    `${value(finding.message)}<br>via ${via}`,
  ];
  return `| ${cells.join(" | ")} |`;
}

/** A collapsed section explaining each rule that fired, and what to do. */
function ruleDetails(findings: readonly Finding[]): string[] {
  const lines = ["<details>", "<summary>About these checks</summary>"];
  for (const ruleId of groupByRule(findings).keys()) {
    const rule = findRule(ruleId);
    if (rule === undefined) continue;
    lines.push("", `**${rule.id} ${rule.name}.** ${rule.why}`, "", `What to do: ${rule.fix}`);
  }
  lines.push("", "</details>");
  return lines;
}

/**
 * Keeps lines, in order, while they fit within `budget` bytes, and replaces
 * the rest with a single line saying how many were left out.
 */
function withinBudget(lines: readonly string[], budget: number, omitted: (count: number) => string): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    const size = encoder.encode(line).length + 1; // + 1 for the newline
    if (used + size > budget) return [...kept, omitted(lines.length - index)];
    kept.push(line);
    used += size;
  }
  return kept;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
