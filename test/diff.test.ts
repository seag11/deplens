import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changedPackages } from "../src/diff.ts";
import type { PackageNode } from "../src/types.ts";
import { pkg } from "./helpers.ts";

const names = (packages: readonly PackageNode[]) => packages.map((p) => `${p.name}@${p.version}`);

describe("changedPackages", () => {
  const base = [pkg({ name: "kept", version: "1.0.0" }), pkg({ name: "bumped", version: "1.0.0" })];

  it("includes new packages and new versions, and leaves out unchanged ones", () => {
    const head = [
      pkg({ name: "kept", version: "1.0.0" }),
      pkg({ name: "bumped", version: "1.1.0" }),
      pkg({ name: "added", version: "2.0.0" }),
    ];
    assert.deepEqual(names(changedPackages(head, base)), ["bumped@1.1.0", "added@2.0.0"]);
  });

  it("includes the same version from a different source", () => {
    const head = [pkg({ name: "kept", version: "1.0.0", resolved: "github:someone/kept#abc" }), base[1]!];
    assert.deepEqual(names(changedPackages(head, base)), ["kept@1.0.0"]);
  });

  it("includes the same version with a different integrity hash", () => {
    const head = [pkg({ name: "kept", version: "1.0.0", integrity: "sha512-BBBB" }), base[1]!];
    assert.deepEqual(names(changedPackages(head, base)), ["kept@1.0.0"]);
  });

  it("ignores packages that were removed", () => {
    assert.deepEqual(changedPackages([base[0]!], base), []);
  });

  it("treats everything as new against an empty base", () => {
    assert.deepEqual(names(changedPackages(base, [])), ["kept@1.0.0", "bumped@1.0.0"]);
  });
});
