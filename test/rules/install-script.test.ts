import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VersionInfo } from "../../src/packument.ts";
import { installScript } from "../../src/rules/install-script.ts";
import { daysAgo, defaultContext, hoursAgo, packumentOf, pkg, version, withPackument } from "../helpers.ts";

const postinstall = { installScripts: { postinstall: "node install.js" } };

/** Checks the last of the given versions, with the lockfile reporting an install script. */
function checkLatest(...versions: VersionInfo[]) {
  const latest = versions.at(-1)!.version;
  return installScript.check(
    pkg({ version: latest, hasInstallScript: true }),
    withPackument(packumentOf("some-lib", versions)),
  );
}

describe("DL001 install-script", () => {
  describe("offline", () => {
    it("flags a package with an install script as low", () => {
      const match = installScript.check(pkg({ hasInstallScript: true }), defaultContext);
      assert.equal(match?.severity, "low");
      assert.equal(match?.message, "Runs a script when it is installed");
      assert.deepEqual(match?.evidence, { hasInstallScript: true });
    });

    it("ignores a package without one", () => {
      assert.equal(installScript.check(pkg(), defaultContext), undefined);
    });

    it("flags dev dependencies too, since their scripts run in CI", () => {
      assert.ok(installScript.check(pkg({ hasInstallScript: true, dev: true }), defaultContext));
    });
  });

  describe("with registry metadata", () => {
    it("shows the script, and stays low when it's old and unchanged", () => {
      const match = checkLatest(
        version("1.0.0", { ...postinstall, publishedAt: daysAgo(60) }),
        version("1.1.0", { ...postinstall, publishedAt: daysAgo(30) }),
      );
      assert.equal(match?.severity, "low");
      assert.equal(match?.message, 'Runs postinstall "node install.js"');
      assert.deepEqual(match?.evidence, {
        hasInstallScript: true,
        scripts: 'postinstall "node install.js"',
        newInThisVersion: false,
        previousVersion: "1.0.0",
        ageHours: 720,
      });
    });

    it("is high when the script is new in this version", () => {
      const match = checkLatest(
        version("1.0.0", { publishedAt: daysAgo(60) }),
        version("1.0.1", { ...postinstall, publishedAt: daysAgo(30) }),
      );
      assert.equal(match?.severity, "high");
      assert.equal(match?.message, 'Runs postinstall "node install.js"; 1.0.0 didn\'t have one');
      assert.equal(match?.evidence["newInThisVersion"], true);
    });

    it("is high when the version is brand new", () => {
      const match = checkLatest(
        version("1.0.0", { ...postinstall, publishedAt: daysAgo(60) }),
        version("1.0.1", { ...postinstall, publishedAt: hoursAgo(3) }),
      );
      assert.equal(match?.severity, "high");
      assert.equal(match?.message, 'Runs postinstall "node install.js"; this version was published 3 hours ago');
    });

    it("gives both reasons when both apply", () => {
      const match = checkLatest(
        version("1.0.0", { publishedAt: daysAgo(60) }),
        version("1.0.1", { ...postinstall, publishedAt: hoursAgo(3) }),
      );
      assert.equal(
        match?.message,
        'Runs postinstall "node install.js"; 1.0.0 didn\'t have one; this version was published 3 hours ago',
      );
    });

    it("lists every install script, and describes native builds", () => {
      const scripts = { installScripts: { preinstall: "node a.js", postinstall: "node b.js" } };
      assert.equal(
        checkLatest(version("1.0.0", scripts))?.evidence["scripts"],
        'preinstall "node a.js", postinstall "node b.js"',
      );
      assert.equal(
        checkLatest(version("1.0.0", { buildsNativeAddon: true }))?.evidence["scripts"],
        "a native build (node-gyp)",
      );
    });

    it("doesn't call a script new for a package's first version", () => {
      const match = checkLatest(version("1.0.0", { ...postinstall, publishedAt: daysAgo(30) }));
      assert.equal(match?.severity, "low");
      assert.equal(match?.evidence["newInThisVersion"], false);
    });

    it("doesn't call a script new when the registry shows none on this version either", () => {
      // The lockfile and registry disagree, so "new" can't be judged.
      const match = checkLatest(version("1.0.0", { publishedAt: daysAgo(60) }), version("1.0.1"));
      assert.equal(match?.severity, "low");
    });

    it("falls back to the offline result when the registry doesn't list this version", () => {
      const match = installScript.check(
        pkg({ version: "7.0.0", hasInstallScript: true }),
        withPackument(packumentOf("some-lib", [version("1.0.0")])),
      );
      assert.equal(match?.message, "Runs a script when it is installed");
    });
  });
});
