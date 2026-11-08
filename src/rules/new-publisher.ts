/**
 * DL005 new-publisher: this version was published by an npm account that
 * never published an earlier version of the package.
 *
 * The registry keeps no history of a package's maintainer list, but every
 * version records who published it, so a change of hands shows up as a new
 * name in that record.
 *
 * This targets handover attacks, where an attacker is given publishing
 * rights. It can't catch stolen accounts or tokens, which publish as the real
 * maintainer, so it stays `low`.
 */

import { findVersion, versionsBefore } from "../packument.ts";
import type { Rule } from "../types.ts";

/** At most this many earlier publishers are listed in the evidence. */
const MAX_LISTED = 5;

export const newPublisher: Rule = {
  id: "DL005",
  name: "new-publisher",
  needsRegistry: true,

  why:
    "Every npm version records the account that published it. A version " +
    "published by an account that never published this package before can " +
    "mean the package changed hands, which is how some attacks begin: the " +
    "attacker offers to help maintain a package and is given publishing " +
    "rights. Projects also add maintainers for ordinary reasons, so this is " +
    "low severity. It doesn't catch stolen accounts or tokens, which publish " +
    "as the real maintainer.",

  fix:
    "Check the package's repository or changelog for news of a new " +
    "maintainer before upgrading.",

  check(pkg, ctx) {
    if (ctx.packument === undefined) return undefined;
    const publisher = findVersion(ctx.packument, pkg.version)?.publisher;

    // Trusted publishing replaces a person's credentials with the project's
    // CI identity. Moving to it is a security improvement, not a new owner.
    if (publisher === undefined || publisher.trusted) return undefined;

    const earlier = versionsBefore(ctx.packument, pkg.version);
    const earlierPublishers = new Set(earlier.flatMap((info) => (info.publisher ? [info.publisher.name] : [])));

    // With no earlier publishers recorded, there is nothing to compare with.
    if (earlierPublishers.size === 0 || earlierPublishers.has(publisher.name)) return undefined;

    const count = earlier.length === 1 ? "the 1 earlier version" : `any of the ${earlier.length} earlier versions`;
    return {
      severity: "low",
      message: `Published by "${publisher.name}", who didn't publish ${count}`,
      evidence: {
        publisher: publisher.name,
        earlierVersions: earlier.length,
        earlierPublishers: [...earlierPublishers].slice(-MAX_LISTED).join(", "),
      },
    };
  },
};
