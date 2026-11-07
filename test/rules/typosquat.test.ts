import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { typosquat } from "../../src/rules/typosquat.ts";
import type { RuleContext } from "../../src/types.ts";
import { defaultContext, pkg } from "../helpers.ts";

/** An invented popular list, most popular first. */
const ctx: RuleContext = {
  ...defaultContext,
  popularPackages: new Set(["fastparse", "widget-kit", "colorize", "qs-lite", "fastparser-core"]),
};

const check = (name: string) => typosquat.check(pkg({ name }), ctx);

describe("DL003 typosquat", () => {
  describe("flags", () => {
    it("a name that differs only in separators", () => {
      for (const name of ["widgetkit", "widget_kit", "widget.kit"]) {
        assert.deepEqual(check(name)?.evidence, { similarTo: "widget-kit", match: "separators" }, name);
      }
    });

    it("a short name one edit away", () => {
      const match = check("colorise");
      assert.equal(match?.severity, "high");
      assert.deepEqual(match?.evidence, { similarTo: "colorize", match: "edit-distance", distance: 1 });
    });

    it("a swapped pair of letters as one edit", () => {
      assert.equal(check("fastpasre")?.evidence["distance"], 1);
    });

    it("a longer name two edits away", () => {
      // 9+ characters: two edits are allowed.
      assert.equal(check("fstparsre")?.evidence["similarTo"], "fastparse");
    });
  });

  describe("doesn't flag", () => {
    it("a short name two edits away", () => {
      // "colrse" is 6 characters, so only one edit is allowed.
      assert.equal(check("colrse"), undefined);
    });

    it("a popular package itself", () => {
      // "fastparse" and "fastparser-core" are close, but both are popular.
      assert.equal(check("fastparse"), undefined);
    });

    it("names shorter than 4 characters", () => {
      assert.equal(typosquat.check(pkg({ name: "qsl" }), { ...ctx, popularPackages: new Set(["qs"]) }), undefined);
    });

    it("unrelated names", () => {
      assert.equal(check("totally-different"), undefined);
    });

    it("anything when there's no popular list", () => {
      assert.equal(typosquat.check(pkg({ name: "colorise" }), defaultContext), undefined);
    });
  });

  it("reports the closest popular package, even if a more popular one is also similar", () => {
    // "abcdefghx" (9 characters, so 2 edits allowed) is 2 edits from the more
    // popular "abcdefgxy" and 1 edit from "abcdefghi".
    const both: RuleContext = { ...defaultContext, popularPackages: new Set(["abcdefgxy", "abcdefghi"]) };
    assert.equal(typosquat.check(pkg({ name: "abcdefghx" }), both)?.evidence["similarTo"], "abcdefghi");
  });

  it("breaks ties in favour of the more popular package", () => {
    const tied: RuleContext = { ...defaultContext, popularPackages: new Set(["abcde", "abcdf"]) };
    // "abcdx" is one edit from both.
    assert.equal(typosquat.check(pkg({ name: "abcdx" }), tied)?.evidence["similarTo"], "abcde");
  });
});
