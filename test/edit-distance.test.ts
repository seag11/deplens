import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { editDistance } from "../src/edit-distance.ts";

describe("editDistance", () => {
  const cases: Array<[a: string, b: string, expected: number, why: string]> = [
    ["widget", "widget", 0, "identical"],
    ["", "abc", 3, "from empty: insert every character"],
    ["abc", "", 3, "to empty: delete every character"],
    ["widget", "widgets", 1, "one insertion"],
    ["widgets", "widget", 1, "one deletion"],
    ["widget", "wodget", 1, "one replacement"],
    ["widget", "wdiget", 1, "one adjacent swap"],
    ["widget", "wigdet", 1, "one adjacent swap in the middle"],
    ["widget", "wdigte", 2, "two separate swaps"],
    ["kitten", "sitting", 3, "the classic example"],
    ["abc", "ca", 3, "optimal string alignment never edits a swapped pair again"],
  ];

  for (const [a, b, expected, why] of cases) {
    it(`"${a}" → "${b}" is ${expected} (${why})`, () => {
      assert.equal(editDistance(a, b), expected);
    });
  }

  it("is symmetric", () => {
    for (const [a, b] of cases) assert.equal(editDistance(a, b), editDistance(b, a));
  });

  describe("with a limit", () => {
    it("returns the exact distance when it is within the limit", () => {
      for (const [a, b, expected] of cases) {
        assert.equal(editDistance(a, b, expected), expected, `${a} → ${b}`);
      }
    });

    it("returns limit + 1 when the distance exceeds the limit", () => {
      for (const [a, b, expected] of cases) {
        if (expected === 0) continue;
        assert.equal(editDistance(a, b, expected - 1), expected, `${a} → ${b}`);
      }
      assert.equal(editDistance("widget", "something-else", 2), 3);
    });

    it("agrees with the unlimited distance on every pair of a word list", () => {
      // Cross-checks the early exit: for every limit, the limited result must
      // be min(distance, limit + 1).
      const words = ["widget", "wdiget", "widgets", "gadget", "wid", "tegdiw", "w-i-d-g-e-t", "kitten", "sitting", ""];
      for (const a of words) {
        for (const b of words) {
          const exact = editDistance(a, b);
          for (let limit = 0; limit <= 4; limit++) {
            assert.equal(editDistance(a, b, limit), Math.min(exact, limit + 1), `${a} → ${b}, limit ${limit}`);
          }
        }
      }
    });
  });
});
