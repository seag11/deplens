import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recentRelease } from "../../src/rules/recent-release.ts";
import { daysAgo, defaultContext, hoursAgo, NOW, packumentOf, pkg, version, withPackument } from "../helpers.ts";

/** Checks some-lib@2.0.0, published at the given time. */
function checkPublishedAt(publishedAt: Date | undefined) {
  const packument = packumentOf("some-lib", [version("1.0.0"), version("2.0.0", { publishedAt })]);
  return recentRelease.check(pkg({ version: "2.0.0" }), withPackument(packument));
}

describe("DL004 recent-release", () => {
  it("flags a version published hours ago as medium", () => {
    const match = checkPublishedAt(hoursAgo(5));
    assert.equal(match?.severity, "medium");
    assert.equal(match?.message, "Published 5 hours ago (2026-06-01T07:00:00.000Z)");
    assert.deepEqual(match?.evidence, { publishedAt: "2026-06-01T07:00:00.000Z", ageHours: 5 });
  });

  it("describes ages in words", () => {
    assert.match(checkPublishedAt(hoursAgo(0.5))?.message ?? "", /^Published less than an hour ago/);
    assert.match(checkPublishedAt(hoursAgo(1))?.message ?? "", /^Published 1 hour ago/);
    assert.match(checkPublishedAt(hoursAgo(50))?.message ?? "", /^Published 2 days ago/);
  });

  it("flags versions up to just under 3 days old, and no older", () => {
    assert.ok(checkPublishedAt(hoursAgo(71)));
    assert.equal(checkPublishedAt(daysAgo(3)), undefined);
    assert.equal(checkPublishedAt(daysAgo(30)), undefined);
  });

  it("treats a publish time in the future as just published", () => {
    const future = new Date(NOW.getTime() + 60_000);
    assert.equal(checkPublishedAt(future)?.evidence["ageHours"], 0);
  });

  it("stays quiet without registry metadata or a publish time", () => {
    assert.equal(recentRelease.check(pkg(), defaultContext), undefined);
    assert.equal(checkPublishedAt(undefined), undefined);
  });

  it("stays quiet when the registry doesn't list the installed version", () => {
    const packument = packumentOf("some-lib", [version("9.0.0", { publishedAt: hoursAgo(1) })]);
    assert.equal(recentRelease.check(pkg({ version: "1.0.0" }), withPackument(packument)), undefined);
  });
});
