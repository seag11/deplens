/**
 * DL001 install-script: the package runs a script when it is installed.
 *
 * npm records this in the lockfile as `hasInstallScript`, so the rule works
 * offline. Many legitimate packages need install scripts (to download or
 * compile a native binary), so on its own this is only `low`.
 *
 * With registry metadata the rule shows the script itself, and escalates to
 * `high` in the two situations that match how compromised releases usually
 * look:
 *   - the script is new: the version published just before had none. Worms
 *     spread by republishing a victim's other packages with a script added,
 *     and legitimate packages rarely add one.
 *   - the version is brand new (see recency.ts): it hasn't been out long
 *     enough for a malicious script to be noticed.
 */

import { findVersion, hasInstallScript, INSTALL_SCRIPTS, versionsBefore, type VersionInfo } from "../packument.ts";
import type { Match, Rule } from "../types.ts";
import { ageInHours, formatAge, isRecent, releaseAgeMs } from "./recency.ts";

export const installScript: Rule = {
  id: "DL001",
  name: "install-script",
  needsRegistry: false,

  why:
    "Install scripts (preinstall, install, postinstall) run with your " +
    "permissions as soon as the package is installed, on developer machines " +
    "and in CI, before your code ever imports it. That makes them the most " +
    "common way malicious packages run their payload. Many legitimate " +
    "packages use them too, for example to fetch a native binary, so on its " +
    "own this is a prompt to look. It is high severity when the script is " +
    "new in this version or the version is only days old, because that is " +
    "how compromised releases usually look.",

  fix:
    "Check that the package needs its install script. If the script is new " +
    "or the version is brand new, stay on the previous version until you " +
    "have read what the script does. To stop scripts from running by " +
    "default, install with `npm ci --ignore-scripts` and run the ones you " +
    "need explicitly, such as with `npm rebuild <package>`.",

  check(pkg, ctx): Match | undefined {
    if (!pkg.hasInstallScript) return undefined;

    const info = ctx.packument && findVersion(ctx.packument, pkg.version);
    if (ctx.packument === undefined || info === undefined) {
      return {
        severity: "low",
        message: "Runs a script when it is installed",
        evidence: { hasInstallScript: true },
      };
    }

    // The script is new only if the registry also shows one on this version;
    // otherwise the lockfile and registry disagree and "new" can't be judged.
    const previous = versionsBefore(ctx.packument, pkg.version).at(-1);
    const isNewScript = previous !== undefined && hasInstallScript(info) && !hasInstallScript(previous);
    const ageMs = releaseAgeMs(info, ctx.now);
    const isFresh = isRecent(ageMs);

    const reasons = [
      ...(isNewScript ? [`${previous.version} didn't have one`] : []),
      ...(isFresh ? [`this version was published ${formatAge(ageMs)} ago`] : []),
    ];
    const scripts = describeScripts(info);

    return {
      severity: reasons.length > 0 ? "high" : "low",
      message: [`Runs ${scripts}`, ...reasons].join("; "),
      evidence: {
        hasInstallScript: true,
        scripts,
        newInThisVersion: isNewScript,
        ...(previous ? { previousVersion: previous.version } : {}),
        ...(ageMs !== undefined ? { ageHours: ageInHours(ageMs) } : {}),
      },
    };
  },
};

/** For example: `postinstall "node install.js"`, or `a native build (node-gyp)`. */
function describeScripts(info: VersionInfo): string {
  const scripts = INSTALL_SCRIPTS.flatMap((name) => {
    const command = info.installScripts[name];
    return command === undefined ? [] : [`${name} "${command}"`];
  });
  if (scripts.length > 0) return scripts.join(", ");
  if (info.buildsNativeAddon) return "a native build (node-gyp)";
  return "an install script";
}
