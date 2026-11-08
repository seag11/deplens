import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { findVersion, hasInstallScript, parsePackument, versionsBefore, type Packument } from "../src/packument.ts";
import { version } from "./helpers.ts";

/** A real esbuild packument, trimmed to three versions (see test/fixtures/registry). */
const esbuild = JSON.parse(readFileSync(new URL("fixtures/registry/esbuild.json", import.meta.url), "utf8"));

describe("parsePackument", () => {
  it("reads a real registry response", () => {
    const packument = parsePackument(esbuild);
    assert.ok(packument);
    assert.equal(packument.name, "esbuild");
    assert.deepEqual(findVersion(packument, "0.28.2"), {
      version: "0.28.2",
      publishedAt: new Date("2026-08-08T20:00:55.454Z"),
      publisher: { name: "GitHub Actions", trusted: true },
      installScripts: { postinstall: "node install.js" },
      buildsNativeAddon: false,
      hasProvenance: true,
    });
  });

  it("orders versions by publish time, not by version number", () => {
    const packument = parsePackument({
      versions: { "2.0.0": {}, "1.0.1": {}, "1.0.0": {} },
      // 1.0.1 is a fix for the old line, published after 2.0.0.
      time: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-02-01T00:00:00Z", "1.0.1": "2026-03-01T00:00:00Z" },
    });
    assert.deepEqual(
      packument?.versions.map((v) => v.version),
      ["1.0.0", "2.0.0", "1.0.1"],
    );
  });

  it("reads only install scripts, and native builds", () => {
    const packument = parsePackument({
      versions: {
        "1.0.0": { scripts: { test: "tap", build: "tsc", preinstall: "node pre.js" }, gypfile: true },
      },
    });
    const info = packument?.versions[0];
    assert.deepEqual(info?.installScripts, { preinstall: "node pre.js" });
    assert.equal(info?.buildsNativeAddon, true);
  });

  it("rejects documents that aren't packuments", () => {
    for (const json of [null, [], "text", {}, { versions: [] }]) {
      assert.equal(parsePackument(json), undefined, JSON.stringify(json));
    }
  });

  it("treats fields of the wrong type as missing", () => {
    const packument = parsePackument({
      versions: {
        "1.0.0": {
          scripts: { postinstall: 42 },
          _npmUser: { name: ["not", "a", "string"] },
          dist: { attestations: "yes" },
          gypfile: "true",
        },
        broken: "not an object",
      },
      time: { "1.0.0": "not a date" },
    });
    assert.deepEqual(packument?.versions, [
      {
        version: "1.0.0",
        publishedAt: undefined,
        publisher: undefined,
        installScripts: {},
        buildsNativeAddon: false,
        hasProvenance: false,
      },
    ]);
  });
});

describe("versionsBefore", () => {
  const packument: Packument = {
    name: "some-lib",
    versions: [
      version("1.0.0", { publishedAt: new Date("2026-01-01T00:00:00Z") }),
      version("1.1.0", { publishedAt: new Date("2026-02-01T00:00:00Z") }),
      version("1.2.0", { publishedAt: new Date("2026-03-01T00:00:00Z") }),
      version("9.9.9", { publishedAt: undefined }),
    ],
  };

  it("lists the versions published earlier, oldest first", () => {
    assert.deepEqual(
      versionsBefore(packument, "1.2.0").map((v) => v.version),
      ["1.0.0", "1.1.0"],
    );
  });

  it("is empty for the first version, an unknown version, or one without a publish time", () => {
    assert.deepEqual(versionsBefore(packument, "1.0.0"), []);
    assert.deepEqual(versionsBefore(packument, "5.0.0"), []);
    assert.deepEqual(versionsBefore(packument, "9.9.9"), []);
  });
});

describe("hasInstallScript", () => {
  it("is true for an install script or a native build", () => {
    assert.equal(hasInstallScript(version("1.0.0")), false);
    assert.equal(hasInstallScript(version("1.0.0", { installScripts: { install: "node-gyp rebuild" } })), true);
    assert.equal(hasInstallScript(version("1.0.0", { buildsNativeAddon: true })), true);
  });
});
