/**
 * Helpers for reading untrusted JSON (lockfiles, registry responses).
 *
 * A field of the wrong type is treated as missing rather than trusted, so a
 * malformed or hostile document can't crash a rule or smuggle in a value of
 * an unexpected type.
 */

/** True for plain JSON objects (not arrays or null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value if it is a string, otherwise undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
