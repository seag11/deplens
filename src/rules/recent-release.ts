/**
 * DL004 recent-release: this version was published less than 3 days ago.
 *
 * Of all the signals, this is the one that fires for nearly every large
 * compromise, because malicious versions are usually found and pulled within
 * hours to days. Run with `--fail-on medium` on pull requests, it works as a
 * cooldown: new versions wait a few days before they are accepted.
 */

import { findVersion } from "../packument.ts";
import type { Rule } from "../types.ts";
import { ageInHours, formatAge, isRecent, releaseAgeMs } from "./recency.ts";

export const recentRelease: Rule = {
  id: "DL004",
  name: "recent-release",
  needsRegistry: true,

  why:
    "Compromised versions are usually spotted and removed within hours to a " +
    "few days of being published. A version this new hasn't had that time " +
    "yet. Waiting a few days before adopting new versions avoids most large " +
    "compromises, including ones whose payload is hidden in the library " +
    "code, where no other check can see it.",

  fix:
    "Wait until the version is a few days old, or stay on the previous " +
    "version for now. To wait automatically everywhere, set a minimum " +
    "release age in your package manager: `min-release-age` (in days) in " +
    "npm's .npmrc, or `minimumReleaseAge` (in minutes) in pnpm.",

  check(pkg, ctx) {
    const info = ctx.packument && findVersion(ctx.packument, pkg.version);
    if (info === undefined) return undefined;

    const ageMs = releaseAgeMs(info, ctx.now);
    if (!isRecent(ageMs) || info.publishedAt === undefined) return undefined;

    return {
      severity: "medium",
      message: `Published ${formatAge(ageMs)} ago (${info.publishedAt.toISOString()})`,
      evidence: { publishedAt: info.publishedAt.toISOString(), ageHours: ageInHours(ageMs) },
    };
  },
};
