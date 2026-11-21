/**
 * Formats a report as JSON, for programs.
 *
 * Each finding includes its rule's explanation, so consumers don't need to
 * know the rules. `schemaVersion` changes only when the shape changes in a
 * way that could break a consumer; adding a field doesn't.
 */

import { findRule } from "../rules/index.ts";
import type { Report } from "../types.ts";
import { countBySeverity } from "./summary.ts";

export function formatJson(report: Report): string {
  const output = {
    schemaVersion: 1,
    packageCount: report.packageCount,
    // Present only when comparing against a base (JSON drops undefined).
    changedCount: report.changedCount,
    summary: countBySeverity(report.findings),
    findings: report.findings.map((finding) => {
      const rule = findRule(finding.ruleId);
      return { ...finding, why: rule?.why, fix: rule?.fix };
    }),
    ignored: report.ignored,
    warnings: report.warnings,
  };
  return JSON.stringify(output, null, 2) + "\n";
}
