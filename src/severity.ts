/** Helpers for comparing and parsing severities. */

import { SEVERITIES, type Severity } from "./types.ts";

/** Position in the severity order: higher means more serious. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** True when `severity` is at least as serious as `threshold`. */
export function isAtLeast(severity: Severity, threshold: Severity): boolean {
  return severityRank(severity) >= severityRank(threshold);
}

/** Narrows user input such as a `--fail-on` value to a Severity. */
export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}
