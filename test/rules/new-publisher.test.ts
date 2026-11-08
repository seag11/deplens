import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VersionInfo } from "../../src/packument.ts";
import { newPublisher } from "../../src/rules/new-publisher.ts";
import { daysAgo, defaultContext, packumentOf, pkg, version, withPackument } from "../helpers.ts";

const by = (name: string, trusted = false) => ({ publisher: { name, trusted } });

/** Checks the last of the given versions, each published a day after the one before. */
function checkLatest(...versions: VersionInfo[]) {
  const dated = versions.map((info, i) => ({ ...info, publishedAt: daysAgo(100 - i) }));
  const latest = dated.at(-1)!;
  return newPublisher.check(pkg({ version: latest.version }), withPackument(packumentOf("some-lib", dated)));
}

describe("DL005 new-publisher", () => {
  it("flags a publisher who never published an earlier version, as low", () => {
    const match = checkLatest(
      version("1.0.0", by("alice")),
      version("1.1.0", by("bob")),
      version("1.2.0", by("mallory")),
    );
    assert.equal(match?.severity, "low");
    assert.equal(match?.message, 'Published by "mallory", who didn\'t publish any of the 2 earlier versions');
    assert.deepEqual(match?.evidence, { publisher: "mallory", earlierVersions: 2, earlierPublishers: "alice, bob" });
  });

  it("accepts any earlier publisher, not just the most recent", () => {
    assert.equal(
      checkLatest(version("1.0.0", by("alice")), version("1.1.0", by("bob")), version("1.2.0", by("alice"))),
      undefined,
    );
  });

  it("doesn't count trusted publishing as a new publisher", () => {
    // Moving from a person's credentials to CI publishing is an improvement.
    assert.equal(checkLatest(version("1.0.0", by("alice")), version("2.0.0", by("GitHub Actions", true))), undefined);
  });

  it("flags a person publishing after trusted publishing, if they never published before", () => {
    const match = checkLatest(version("1.0.0", by("GitHub Actions", true)), version("1.0.1", by("mallory")));
    assert.equal(match?.evidence["publisher"], "mallory");
  });

  it("stays quiet for a package's first version", () => {
    assert.equal(checkLatest(version("1.0.0", by("alice"))), undefined);
  });

  it("stays quiet when publishers aren't recorded", () => {
    assert.equal(checkLatest(version("1.0.0", { publisher: undefined }), version("1.1.0", by("alice"))), undefined);
    assert.equal(checkLatest(version("1.0.0", by("alice")), version("1.1.0", { publisher: undefined })), undefined);
  });

  it("stays quiet without registry metadata", () => {
    assert.equal(newPublisher.check(pkg(), defaultContext), undefined);
  });
});
