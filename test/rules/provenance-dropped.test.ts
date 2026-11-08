import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { provenanceDropped } from "../../src/rules/provenance-dropped.ts";
import { daysAgo, defaultContext, packumentOf, pkg, version, withPackument } from "../helpers.ts";

/**
 * Checks the last version of a history given as provenance flags, oldest
 * first: [true, true, false] means 1.0.0 and 1.0.1 had provenance and 1.0.2
 * (the version checked) doesn't.
 */
function checkHistory(...provenance: boolean[]) {
  const versions = provenance.map((hasProvenance, i) =>
    version(`1.0.${i}`, { hasProvenance, publishedAt: daysAgo(100 - i) }),
  );
  const latest = versions.at(-1)!.version;
  return provenanceDropped.check(pkg({ version: latest }), withPackument(packumentOf("some-lib", versions)));
}

describe("DL006 provenance-dropped", () => {
  it("flags a version without provenance after versions with it, as high", () => {
    const match = checkHistory(false, true, true, true, false);
    assert.equal(match?.severity, "high");
    assert.equal(match?.message, "1.0.3 and the 2 versions before it were published with provenance; 1.0.4 has none");
    assert.deepEqual(match?.evidence, { previousVersion: "1.0.3", versionsWithProvenance: 3 });
  });

  it("words a single earlier version naturally", () => {
    assert.equal(checkHistory(true, false)?.message, "1.0.0 was published with provenance; 1.0.1 has none");
  });

  it("stays quiet when this version has provenance", () => {
    assert.equal(checkHistory(true, true), undefined);
  });

  it("stays quiet when the version just before had none, even if older ones did", () => {
    // The project stopped using provenance earlier; this release changes nothing.
    assert.equal(checkHistory(true, false, false), undefined);
  });

  it("stays quiet for a package that never used provenance, or its first version", () => {
    assert.equal(checkHistory(false, false, false), undefined);
    assert.equal(checkHistory(false), undefined);
  });

  it("stays quiet without registry metadata", () => {
    assert.equal(provenanceDropped.check(pkg(), defaultContext), undefined);
  });
});
