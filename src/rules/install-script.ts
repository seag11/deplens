/**
 * DL001 install-script: the package runs a script when it is installed.
 *
 * npm records this in the lockfile as `hasInstallScript`, so the rule works
 * offline. Many legitimate packages need install scripts (to download or
 * compile a native binary), so on its own this is only `low`.
 */

import type { Rule } from "../types.ts";

export const installScript: Rule = {
  id: "DL001",
  name: "install-script",

  why:
    "Install scripts (preinstall, install, postinstall) run with your " +
    "permissions as soon as the package is installed, on developer machines " +
    "and in CI, before your code ever imports it. That makes them the most " +
    "common way malicious packages run their payload. Many legitimate " +
    "packages use them too, for example to fetch a native binary, so this is " +
    "a prompt to look rather than a problem in itself.",

  fix:
    "Check that the package needs its install script. To stop scripts from " +
    "running by default, install with `npm ci --ignore-scripts` and run the " +
    "ones you need explicitly, such as with `npm rebuild <package>`.",

  check(pkg) {
    if (!pkg.hasInstallScript) return undefined;
    return {
      severity: "low",
      message: "Runs a script when it is installed",
      evidence: { hasInstallScript: true },
    };
  },
};
