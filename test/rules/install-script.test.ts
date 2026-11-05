import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { installScript } from "../../src/rules/install-script.ts";
import { defaultContext, pkg } from "../helpers.ts";

describe("DL001 install-script", () => {
  it("flags a package with an install script as low", () => {
    const match = installScript.check(pkg({ hasInstallScript: true }), defaultContext);
    assert.equal(match?.severity, "low");
    assert.deepEqual(match?.evidence, { hasInstallScript: true });
  });

  it("ignores a package without one", () => {
    assert.equal(installScript.check(pkg(), defaultContext), undefined);
  });

  it("flags dev dependencies too, since their scripts run in CI", () => {
    assert.ok(installScript.check(pkg({ hasInstallScript: true, dev: true }), defaultContext));
  });
});
