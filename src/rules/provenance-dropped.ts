/**
 * DL006 provenance-dropped: the version published before this one had a
 * provenance attestation, and this one doesn't.
 *
 * Provenance is a signed record, attached by npm, of the CI workflow and
 * source commit that built a version. A project that publishes from CI gets
 * it on every release, so a release without it was probably published from
 * somewhere else, such as an attacker's machine with a stolen token.
 *
 * It isn't proof of safety: an attacker who hijacks the project's own CI
 * workflow publishes with a valid attestation. Other rules (DL001, DL004)
 * still fire in that case.
 */

import { findVersion, versionsBefore } from "../packument.ts";
import type { Rule } from "../types.ts";

export const provenanceDropped: Rule = {
  id: "DL006",
  name: "provenance-dropped",
  needsRegistry: true,

  why:
    "Provenance is a signed record, attached by npm, of the CI workflow and " +
    "source commit that built a version. When earlier versions have it and " +
    "this one doesn't, this version was probably not published from the " +
    "project's CI. That is what publishing with a stolen npm token looks " +
    "like. Provenance doesn't prove a version is safe, though: an attacker " +
    "who hijacks the project's CI publishes with valid provenance.",

  fix:
    "Stay on the previous version and check the project's repository for a " +
    "release that matches this one. Projects occasionally publish one " +
    "release by hand, so look for an explanation before assuming the worst.",

  check(pkg, ctx) {
    if (ctx.packument === undefined) return undefined;
    const info = findVersion(ctx.packument, pkg.version);
    if (info === undefined || info.hasProvenance) return undefined;

    // Count the unbroken run of provenance-carrying versions just before this
    // one. A project that stopped using provenance long ago has no run.
    const earlier = versionsBefore(ctx.packument, pkg.version);
    let run = 0;
    while (run < earlier.length && earlier[earlier.length - 1 - run]?.hasProvenance) run += 1;
    const previous = earlier.at(-1);
    if (run === 0 || previous === undefined) return undefined;

    const history =
      run === 1
        ? `${previous.version} was published with provenance`
        : `${previous.version} and the ${run - 1} versions before it were published with provenance`;
    return {
      severity: "high",
      message: `${history}; ${pkg.version} has none`,
      evidence: { previousVersion: previous.version, versionsWithProvenance: run },
    };
  },
};
