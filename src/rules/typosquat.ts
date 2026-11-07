/**
 * DL003 typosquat: the package's name is suspiciously close to a popular
 * package's name.
 *
 * Two checks against the list of popular packages:
 *   - the same name apart from separators (`some-lib` vs `somelib`)
 *   - a small edit distance (`lodahs` vs `lodash`)
 *
 * Similar names are common among legitimate packages too, so the check stays
 * narrow: very short names are skipped, the allowed distance grows only for
 * longer names, and a package that is itself popular is never flagged.
 */

import { editDistance } from "../edit-distance.ts";
import type { Match, Rule } from "../types.ts";

/**
 * Names shorter than this are skipped. Nearly every short name is one edit
 * away from some popular short name, so flagging them would be mostly noise.
 */
const MIN_LENGTH = 4;

/** Characters npm names commonly differ by: `some-lib`, `some_lib`, `some.lib`. */
const SEPARATORS = /[-_.]/g;

/** How close a name has to be to count as similar to a popular package. */
type Similarity =
  | { readonly kind: "separators"; readonly popular: string }
  | { readonly kind: "edit"; readonly popular: string; readonly distance: number };

export const typosquat: Rule = {
  id: "DL003",
  name: "typosquat",

  why:
    "Typosquatting means publishing a malicious package under a name one " +
    "typo away from a popular package: a swapped letter, a missing hyphen, an " +
    "extra character. It relies on someone mistyping an install command or a " +
    "package.json entry. Some legitimate packages have similar names too, so " +
    "this is a prompt to check which package you meant.",

  fix:
    "Check that this is the package you meant. If it isn't, fix the name in " +
    "package.json and reinstall. Its install scripts may already have run, so " +
    "also check the machines and CI runners that installed it.",

  check(pkg, ctx): Match | undefined {
    if (pkg.name.length < MIN_LENGTH || ctx.popularPackages.has(pkg.name)) return undefined;

    const similarity = findSimilar(pkg.name, ctx.popularPackages);
    if (similarity === undefined) return undefined;

    if (similarity.kind === "separators") {
      return {
        severity: "high",
        message: `Same name as the popular package "${similarity.popular}" apart from separators`,
        evidence: { similarTo: similarity.popular, match: "separators" },
      };
    }
    const edits = similarity.distance === 1 ? "1 edit" : `${similarity.distance} edits`;
    return {
      severity: "high",
      message: `Name is ${edits} away from the popular package "${similarity.popular}"`,
      evidence: { similarTo: similarity.popular, match: "edit-distance", distance: similarity.distance },
    };
  },
};

/**
 * The largest edit distance that still counts as similar. One edit for names
 * of up to 8 characters, two for longer ones: a longer name has more room for
 * a typo before it starts to look like a different name.
 */
function maxDistance(name: string): number {
  return name.length <= 8 ? 1 : 2;
}

/**
 * Finds the popular package `name` most resembles, if any. A separator-only
 * difference wins outright. Otherwise the smallest edit distance wins, and
 * ties go to the more popular package, since `popular` is ordered most
 * popular first.
 */
function findSimilar(name: string, popular: ReadonlySet<string>): Similarity | undefined {
  const limit = maxDistance(name);
  const bare = name.replace(SEPARATORS, "");
  let closest: Similarity | undefined;

  for (const candidate of popular) {
    if (candidate.replace(SEPARATORS, "") === bare) return { kind: "separators", popular: candidate };

    const distance = editDistance(name, candidate, limit);
    if (distance <= limit && (closest?.kind !== "edit" || distance < closest.distance)) {
      closest = { kind: "edit", popular: candidate, distance };
    }
  }

  return closest;
}
