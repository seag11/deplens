import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LockfileError, parseLockfile } from "../src/lockfile.ts";
import type { PackageNode } from "../src/types.ts";
import { lockfileText, registryEntry } from "./helpers.ts";

/** Parses a lockfile and returns the package with the given name and version. */
function find(text: string, name: string, version?: string): PackageNode {
  const match = parseLockfile(text).packages.find(
    (p) => p.name === name && (version === undefined || p.version === version),
  );
  assert.ok(match, `expected ${name}${version ? `@${version}` : ""} in the parsed lockfile`);
  return match;
}

describe("parseLockfile", () => {
  describe("rejects what it can't read", () => {
    it("invalid JSON", () => {
      assert.throws(() => parseLockfile("{ nope"), LockfileError);
    });

    it("lockfileVersion 1, with upgrade advice", () => {
      assert.throws(
        () => parseLockfile(JSON.stringify({ lockfileVersion: 1, dependencies: {} })),
        (error: Error) => error instanceof LockfileError && /--lockfile-version 3/.test(error.message),
      );
    });

    it("a missing packages map", () => {
      assert.throws(() => parseLockfile(JSON.stringify({ lockfileVersion: 3 })), LockfileError);
    });

    it("an entry that isn't an object", () => {
      assert.throws(() => parseLockfile(lockfileText({ "node_modules/a": "1.0.0" })), LockfileError);
    });
  });

  it("accepts lockfileVersion 2", () => {
    const text = JSON.stringify({
      name: "my-app",
      lockfileVersion: 2,
      packages: { "": { dependencies: { a: "^1" } }, "node_modules/a": registryEntry("a", "1.0.0") },
    });
    assert.equal(parseLockfile(text).packages.length, 1);
  });

  it("reads the project name", () => {
    assert.equal(parseLockfile(lockfileText({}, "shop")).rootName, "shop");
  });

  it("reads the fields rules need", () => {
    const text = lockfileText({
      "node_modules/a": registryEntry("a", "1.2.3", { dev: true, hasInstallScript: true }),
    });
    assert.deepEqual(find(text, "a"), {
      name: "a",
      version: "1.2.3",
      resolved: "https://registry.npmjs.org/a/-/a-1.2.3.tgz",
      integrity: "sha512-AAAA",
      hasInstallScript: true,
      dev: true,
      bundled: false,
      path: ["my-app", "a@1.2.3"],
    });
  });

  describe("names", () => {
    it("keeps the scope of scoped packages", () => {
      const text = lockfileText({ "node_modules/@scope/pkg": registryEntry("@scope/pkg", "1.0.0") });
      assert.equal(find(text, "@scope/pkg").name, "@scope/pkg");
    });

    it("uses the real name of an npm: alias, not the folder name", () => {
      // "my-alias": "npm:real-lib@2.0.0" installs real-lib into node_modules/my-alias.
      const text = lockfileText({
        "": { name: "my-app", dependencies: { "my-alias": "npm:real-lib@2.0.0" } },
        "node_modules/my-alias": registryEntry("real-lib", "2.0.0", { name: "real-lib" }),
      });
      assert.deepEqual(find(text, "real-lib").path, ["my-app", "real-lib@2.0.0"]);
    });
  });

  describe("dependency paths", () => {
    it("follows nested and hoisted dependencies to the shortest path", () => {
      // my-app → a → b; b → c. c is reachable only through b.
      const text = lockfileText({
        "": { name: "my-app", dependencies: { a: "^1" } },
        "node_modules/a": registryEntry("a", "1.0.0", { dependencies: { b: "^1" } }),
        "node_modules/a/node_modules/b": registryEntry("b", "1.0.0", { dependencies: { c: "^1" } }),
        "node_modules/c": registryEntry("c", "1.0.0"),
      });
      assert.deepEqual(find(text, "c").path, ["my-app", "a@1.0.0", "b@1.0.0", "c@1.0.0"]);
    });

    it("prefers the nested copy over the hoisted one, as Node does", () => {
      // a needs b@2, nested under a. The hoisted b@1 belongs to the project.
      const text = lockfileText({
        "": { name: "my-app", dependencies: { a: "^1", b: "^1" } },
        "node_modules/a": registryEntry("a", "1.0.0", { dependencies: { b: "^2" } }),
        "node_modules/a/node_modules/b": registryEntry("b", "2.0.0"),
        "node_modules/b": registryEntry("b", "1.0.0"),
      });
      assert.deepEqual(find(text, "b", "2.0.0").path, ["my-app", "a@1.0.0", "b@2.0.0"]);
      assert.deepEqual(find(text, "b", "1.0.0").path, ["my-app", "b@1.0.0"]);
    });

    it("reaches dependencies of workspaces through their folder", () => {
      const text = lockfileText({
        "": { name: "my-app", workspaces: ["packages/*"] },
        "node_modules/web": { resolved: "packages/web", link: true },
        "packages/web": { name: "web", version: "1.0.0", dependencies: { a: "^1" } },
        "node_modules/a": registryEntry("a", "1.0.0"),
      });
      assert.deepEqual(find(text, "a").path, ["my-app", "web", "a@1.0.0"]);
    });

    it("counts devDependencies of the project but not of installed packages", () => {
      // a lists b as a devDependency, which npm never installs for a, so the
      // only path to b is as the project's own devDependency.
      const text = lockfileText({
        "": { name: "my-app", dependencies: { a: "^1" }, devDependencies: { b: "^1" } },
        "node_modules/a": registryEntry("a", "1.0.0", { devDependencies: { b: "^1" } }),
        "node_modules/b": registryEntry("b", "1.0.0", { dev: true }),
      });
      assert.deepEqual(find(text, "b").path, ["my-app", "b@1.0.0"]);
    });

    it("gives packages nothing depends on a direct path", () => {
      const text = lockfileText({ "node_modules/orphan": registryEntry("orphan", "1.0.0") });
      assert.deepEqual(find(text, "orphan").path, ["my-app", "orphan@1.0.0"]);
    });
  });

  it("leaves out the project itself, workspace folders and links", () => {
    const text = lockfileText({
      "node_modules/web": { resolved: "packages/web", link: true },
      "packages/web": { name: "web", version: "1.0.0" },
      "node_modules/a": registryEntry("a", "1.0.0"),
    });
    assert.deepEqual(
      parseLockfile(text).packages.map((p) => p.name),
      ["a"],
    );
  });

  it("marks bundled packages", () => {
    const text = lockfileText({
      "node_modules/a": registryEntry("a", "1.0.0"),
      "node_modules/a/node_modules/inner": { version: "1.0.0", inBundle: true },
    });
    assert.equal(find(text, "inner").bundled, true);
  });

  it("merges copies of the same package into one", () => {
    // b@1.0.0 is installed twice: as a dev-only copy under a, and as a
    // production copy with an install script under c.
    const text = lockfileText({
      "": { name: "my-app", devDependencies: { a: "^1" }, dependencies: { c: "^1" } },
      "node_modules/a": registryEntry("a", "1.0.0", { dev: true, dependencies: { b: "^1" } }),
      "node_modules/a/node_modules/b": registryEntry("b", "1.0.0", { dev: true }),
      "node_modules/c": registryEntry("c", "1.0.0", { dependencies: { b: "^1" } }),
      "node_modules/c/node_modules/b": registryEntry("b", "1.0.0", { hasInstallScript: true }),
    });
    const copies = parseLockfile(text).packages.filter((p) => p.name === "b");
    assert.equal(copies.length, 1);
    assert.equal(copies[0]?.dev, false);
    assert.equal(copies[0]?.hasInstallScript, true);
  });

  it("treats fields of the wrong type as missing", () => {
    const text = lockfileText({
      "node_modules/a": { version: "1.0.0", resolved: 42, integrity: null, hasInstallScript: "yes" },
    });
    const a = find(text, "a");
    assert.equal(a.resolved, undefined);
    assert.equal(a.integrity, undefined);
    assert.equal(a.hasInstallScript, false);
  });
});
