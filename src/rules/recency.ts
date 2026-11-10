/**
 * How recently a version was published. Shared by the rules that care about
 * a version's age (DL001, DL004, DL005), so the time windows live in one
 * place.
 */

import type { VersionInfo } from "../packument.ts";

/**
 * A version younger than this is "recent". Compromised versions are usually
 * found and pulled within hours to a few days, and 3 days sits inside the
 * 1 to 7 day range commonly recommended for release cooldowns.
 */
export const RECENT_RELEASE_DAYS = 3;

/**
 * A new publisher is only worth flagging on a version younger than this. A
 * version that has been public for months without being pulled has had time
 * to be scrutinised, and handover attacks have historically been discovered
 * within weeks to a few months.
 */
export const NEW_PUBLISHER_WINDOW_DAYS = 90;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago the version was published, in milliseconds, or undefined if
 * the registry doesn't say. A publish time in the future (clock skew) counts
 * as just published.
 */
export function releaseAgeMs(info: VersionInfo, now: Date): number | undefined {
  if (info.publishedAt === undefined) return undefined;
  return Math.max(0, now.getTime() - info.publishedAt.getTime());
}

/** True when the age is known and less than the given number of days. */
export function isYoungerThan(ageMs: number | undefined, days: number): ageMs is number {
  return ageMs !== undefined && ageMs < days * DAY_MS;
}

/** True when the version was published less than RECENT_RELEASE_DAYS ago. */
export function isRecent(ageMs: number | undefined): ageMs is number {
  return isYoungerThan(ageMs, RECENT_RELEASE_DAYS);
}

/** Whole hours, for evidence. */
export function ageInHours(ageMs: number): number {
  return Math.floor(ageMs / HOUR_MS);
}

/** A human description of an age: "less than an hour", "5 hours", "2 days". */
export function formatAge(ageMs: number): string {
  const hours = ageInHours(ageMs);
  if (hours < 1) return "less than an hour";
  if (hours < 48) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${Math.floor(ageMs / DAY_MS)} days`;
}
