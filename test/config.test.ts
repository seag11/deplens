import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError, parseConfig } from "../src/config.ts";

const RULE_IDS = ["DL001", "DL002"];
const parse = (config: unknown) => parseConfig(JSON.stringify(config), RULE_IDS);

/** Asserts that parsing fails with a ConfigError whose message matches. */
function rejects(config: unknown, message: RegExp) {
  assert.throws(
    () => (typeof config === "string" ? parseConfig(config, RULE_IDS) : parse(config)),
    (error: Error) => error instanceof ConfigError && message.test(error.message),
  );
}

describe("parseConfig", () => {
  it("reads ignore rules, with and without a version", () => {
    const config = parse({
      ignore: [
        { rule: "DL002", package: "internal-lib", reason: "Our own git-hosted package" },
        { rule: "DL001", package: "native-addon", version: "3.1.0", reason: "Reviewed the build script" },
      ],
    });
    assert.deepEqual(config.ignore, [
      { rule: "DL002", package: "internal-lib", reason: "Our own git-hosted package" },
      { rule: "DL001", package: "native-addon", version: "3.1.0", reason: "Reviewed the build script" },
    ]);
  });

  it("accepts exact versions, including prereleases and build metadata", () => {
    for (const version of ["3.1.0", "0.0.1", "1.0.0-beta.1", "2.0.0-rc.1+build.5", "10.20.30"]) {
      assert.equal(parse({ ignore: [{ rule: "DL001", package: "a", version, reason: "x" }] }).ignore[0]?.version, version);
    }
  });

  it("accepts an empty object", () => {
    assert.deepEqual(parse({}), { ignore: [] });
  });

  it("trims whitespace from values", () => {
    assert.equal(parse({ ignore: [{ rule: " DL001 ", package: "a", reason: "  ok " }] }).ignore[0]?.reason, "ok");
  });

  describe("rejects", () => {
    it("invalid JSON", () => rejects("{ nope", /isn't valid JSON/));

    it("anything but an object", () => rejects([], /must contain a JSON object/));

    it("unknown keys, so a typo doesn't silently do nothing", () => {
      rejects({ ignores: [] }, /Unknown key "ignores".*Allowed: ignore/);
      rejects({ ignore: [{ rule: "DL001", packages: "a", reason: "x" }] }, /Unknown key "packages" in ignore\[0\]/);
    });

    it("an ignore list that isn't an array", () => rejects({ ignore: {} }, /"ignore" .* must be an array/));

    it("an entry that isn't an object", () => rejects({ ignore: ["DL001"] }, /ignore\[0\] .* must be an object/));

    it("an unknown rule ID, listing the real ones", () => {
      rejects({ ignore: [{ rule: "DL0001", package: "a", reason: "x" }] }, /"DL0001" isn't a deplens rule. Rules: DL001, DL002/);
    });

    it("a missing or empty reason", () => {
      rejects({ ignore: [{ rule: "DL001", package: "a" }] }, /ignore\[0\]\.reason .* must be a non-empty string/);
      rejects({ ignore: [{ rule: "DL001", package: "a", reason: "   " }] }, /ignore\[0\]\.reason/);
    });

    it("a missing package, or a version that isn't a string", () => {
      rejects({ ignore: [{ rule: "DL001", reason: "x" }] }, /ignore\[0\]\.package/);
      rejects({ ignore: [{ rule: "DL001", package: "a", version: 3, reason: "x" }] }, /ignore\[0\]\.version/);
    });

    it("a version range, since it would cover future releases", () => {
      for (const version of ["^3.1.0", "~3.1.0", "3.x", "*", ">=3.0.0", "3.1", "latest", "v3.1.0"]) {
        rejects(
          { ignore: [{ rule: "DL001", package: "a", version, reason: "x" }] },
          /must be an exact version such as 3\.1\.0/,
        );
      }
    });

    it("pointing at the right entry", () => {
      const ok = { rule: "DL001", package: "a", reason: "x" };
      rejects({ ignore: [ok, ok, { ...ok, reason: "" }] }, /ignore\[2\]\.reason/);
    });
  });
});
