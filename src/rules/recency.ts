/**
 * How recently a version was published. Shared by the rules that treat
 * brand-new versions as riskier (DL001 and DL004), so they agree on what
 * "recent" means.
 */

import type { VersionInfo } from "../packument.ts";

/**
 * A version younger than this is "recent". Compromised versions are usually
 * found and pulled within hours to a few days, and 3 days sits inside the
 * 1 to 7 day range commonly recommended for release cooldowns.
 */
export const RECENT_RELEASE_DAYS = 3;

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

/** True when the version was published less than RECENT_RELEASE_DAYS ago. */
export function isRecent(ageMs: number | undefined): ageMs is number {
  return ageMs !== undefined && ageMs < RECENT_RELEASE_DAYS * DAY_MS;
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
