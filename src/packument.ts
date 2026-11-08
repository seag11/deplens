/**
 * A package's registry metadata, reduced to what deplens reads.
 *
 * The registry calls the full metadata document for a package a "packument":
 * every published version's manifest, plus a map of publish times. Full
 * packuments can be megabytes, so parsePackument() keeps only the handful of
 * fields the rules use. The smaller "abbreviated" format isn't enough,
 * because it leaves out publish times and publishers.
 */

import { asString, isObject } from "./json.ts";

/** The lifecycle scripts npm runs automatically when installing a package. */
export const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"] as const;

export type InstallScriptName = (typeof INSTALL_SCRIPTS)[number];

/** Who published a version. */
export interface Publisher {
  /** The npm account name, or the CI identity for trusted publishing. */
  readonly name: string;
  /**
   * True when the version was published through trusted publishing: npm
   * accepted a short-lived token from the project's CI instead of a
   * person's credentials.
   */
  readonly trusted: boolean;
}

/** One published version. */
export interface VersionInfo {
  readonly version: string;
  /** When the version was published; undefined if the registry doesn't say. */
  readonly publishedAt: Date | undefined;
  readonly publisher: Publisher | undefined;
  /** The install scripts this version declares, such as `{ postinstall: "node install.js" }`. */
  readonly installScripts: Readonly<Partial<Record<InstallScriptName, string>>>;
  /**
   * True when the package has a `binding.gyp`, which makes npm run
   * `node-gyp rebuild` on install even without an install script.
   */
  readonly buildsNativeAddon: boolean;
  /** True when the version carries a provenance attestation. */
  readonly hasProvenance: boolean;
}

export interface Packument {
  readonly name: string;
  /** Every version, oldest first. Versions without a publish time come last. */
  readonly versions: readonly VersionInfo[];
}

/**
 * Reads a packument from parsed JSON. Returns undefined if the document
 * isn't a packument at all. Fields of the wrong type are treated as missing.
 */
export function parsePackument(json: unknown): Packument | undefined {
  if (!isObject(json) || !isObject(json["versions"])) return undefined;
  const times = isObject(json["time"]) ? json["time"] : {};

  const versions: VersionInfo[] = [];
  for (const [version, manifest] of Object.entries(json["versions"])) {
    if (isObject(manifest)) versions.push(readVersion(version, manifest, times[version]));
  }
  versions.sort(byPublishTime);

  return { name: asString(json["name"]) ?? "", versions };
}

/** Finds a version's metadata. */
export function findVersion(packument: Packument, version: string): VersionInfo | undefined {
  return packument.versions.find((info) => info.version === version);
}

/**
 * The versions published before `version`, oldest first. The last entry is
 * the version published just before it. Empty if `version` is unknown or has
 * no publish time.
 *
 * "Before" means publish time, not version number, because the question the
 * rules ask is "what changed since the last release?". A fix released for an
 * older major version is still the latest thing the publisher did.
 */
export function versionsBefore(packument: Packument, version: string): readonly VersionInfo[] {
  const publishedAt = findVersion(packument, version)?.publishedAt;
  if (publishedAt === undefined) return [];
  return packument.versions.filter(
    (info) => info.publishedAt !== undefined && info.publishedAt.getTime() < publishedAt.getTime(),
  );
}

/** True when installing this version runs code. */
export function hasInstallScript(info: VersionInfo): boolean {
  return info.buildsNativeAddon || Object.keys(info.installScripts).length > 0;
}

function readVersion(version: string, manifest: Record<string, unknown>, time: unknown): VersionInfo {
  const scripts = isObject(manifest["scripts"]) ? manifest["scripts"] : {};
  const installScripts: Partial<Record<InstallScriptName, string>> = {};
  for (const name of INSTALL_SCRIPTS) {
    const command = asString(scripts[name]);
    if (command !== undefined) installScripts[name] = command;
  }

  const user = manifest["_npmUser"];
  const userName = isObject(user) ? asString(user["name"]) : undefined;
  const publisher =
    isObject(user) && userName !== undefined
      ? { name: userName, trusted: isObject(user["trustedPublisher"]) }
      : undefined;

  const dist = isObject(manifest["dist"]) ? manifest["dist"] : {};
  const attestations = dist["attestations"];

  return {
    version,
    publishedAt: parseDate(time),
    publisher,
    installScripts,
    buildsNativeAddon: manifest["gypfile"] === true,
    hasProvenance: isObject(attestations) && isObject(attestations["provenance"]),
  };
}

function parseDate(value: unknown): Date | undefined {
  const text = asString(value);
  if (text === undefined) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function byPublishTime(a: VersionInfo, b: VersionInfo): number {
  // MAX_SAFE_INTEGER rather than Infinity, so two missing times compare as
  // equal instead of producing NaN.
  const time = (info: VersionInfo) => info.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return time(a) - time(b);
}
