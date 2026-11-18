/**
 * Reads deplens's configuration file, `.deplens.json`.
 *
 *   {
 *     "ignore": [
 *       { "rule": "DL002", "package": "internal-lib", "reason": "Our own git-hosted package" },
 *       { "rule": "DL001", "package": "native-addon", "version": "3.1.0", "reason": "Reviewed the build script" }
 *     ]
 *   }
 *
 * Validation is strict: an unknown key, an unknown rule ID or a missing reason
 * is an error, not something to skip. In a security tool's configuration, a
 * typo that silently matches nothing is worse than a failed run.
 */

import { asString, isObject } from "./json.ts";

/** The configuration file's name, looked for in the scanned folder. */
export const CONFIG_FILE = ".deplens.json";

/** An accepted finding: a rule that shouldn't be reported for a package. */
export interface IgnoreRule {
  /** The rule ID, such as `DL002`. */
  readonly rule: string;
  /** The package's real name. */
  readonly package: string;
  /**
   * Only this exact version. Without one, every version is ignored, including
   * future ones, which would also hide a future compromised release.
   */
  readonly version?: string;
  /** Why the finding is accepted. Required, and shown in every report. */
  readonly reason: string;
}

export interface Config {
  readonly ignore: readonly IgnoreRule[];
}

/** The configuration file is invalid. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

const TOP_LEVEL_KEYS = ["ignore"];
const IGNORE_KEYS = ["rule", "package", "version", "reason"];

/**
 * Parses and validates a configuration file.
 *
 * @param knownRuleIds The rule IDs that exist, to catch typos such as `DL0002`.
 * @throws ConfigError describing the first problem found.
 */
export function parseConfig(text: string, knownRuleIds: readonly string[]): Config {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(json)) throw new ConfigError(`${CONFIG_FILE} must contain a JSON object.`);
  rejectUnknownKeys(json, TOP_LEVEL_KEYS, CONFIG_FILE);

  const ignore = json["ignore"] ?? [];
  if (!Array.isArray(ignore)) throw new ConfigError(`"ignore" in ${CONFIG_FILE} must be an array.`);

  return { ignore: ignore.map((entry, index) => readIgnoreRule(entry, `ignore[${index}]`, knownRuleIds)) };
}

function readIgnoreRule(entry: unknown, where: string, knownRuleIds: readonly string[]): IgnoreRule {
  if (!isObject(entry)) throw new ConfigError(`${where} in ${CONFIG_FILE} must be an object.`);
  rejectUnknownKeys(entry, IGNORE_KEYS, where);

  const rule = requiredString(entry, "rule", where);
  if (!knownRuleIds.includes(rule)) {
    throw new ConfigError(`${where}.rule "${rule}" isn't a deplens rule. Rules: ${knownRuleIds.join(", ")}.`);
  }
  const pkg = requiredString(entry, "package", where);
  const reason = requiredString(entry, "reason", where);

  if (entry["version"] === undefined) return { rule, package: pkg, reason };
  return { rule, package: pkg, version: requiredString(entry, "version", where), reason };
}

/** A non-empty string field, or a ConfigError naming exactly what's wrong. */
function requiredString(entry: Record<string, unknown>, key: string, where: string): string {
  const value = asString(entry[key])?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${where}.${key} in ${CONFIG_FILE} must be a non-empty string.`);
  }
  return value;
}

function rejectUnknownKeys(object: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new ConfigError(`Unknown key "${unknown}" in ${where}. Allowed: ${allowed.join(", ")}.`);
  }
}
