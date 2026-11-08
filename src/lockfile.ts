/**
 * Parses npm lockfiles (`package-lock.json` and `npm-shrinkwrap.json`).
 *
 * Supports lockfileVersion 2 and 3, written by npm 7 and later. Both have a
 * `packages` map keyed by install location:
 *
 *   ""                                  the project itself
 *   "node_modules/a"                    a hoisted package
 *   "node_modules/a/node_modules/b"     a copy of b nested under a
 *   "packages/web"                      a workspace folder
 *   "node_modules/web"                  a link to that workspace folder
 *
 * The parser turns that map into one PackageNode per installed package and
 * works out the shortest dependency path to each, by resolving dependencies
 * the same way Node does: look in the nearest node_modules folder, then walk
 * up towards the project root.
 */

import { asString, isObject } from "./json.ts";
import type { Lockfile, PackageNode } from "./types.ts";

/** The lockfile can't be read: invalid JSON, wrong shape or unsupported version. */
export class LockfileError extends Error {
  override name = "LockfileError";
}

/** The fields deplens reads from one entry of the `packages` map. */
interface Entry {
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly resolved: string | undefined;
  readonly integrity: string | undefined;
  readonly link: boolean;
  readonly dev: boolean;
  readonly inBundle: boolean;
  readonly hasInstallScript: boolean;
  /** Names this entry depends on, as they appear in node_modules. */
  readonly dependencies: readonly string[];
}

const NODE_MODULES = "node_modules/";

/**
 * Parses lockfile text.
 *
 * @throws LockfileError if the text isn't a lockfile deplens can read.
 */
export function parseLockfile(text: string): Lockfile {
  const doc = parseJson(text);

  const version = doc["lockfileVersion"];
  if (version === 1) {
    throw new LockfileError(
      "lockfileVersion 1 (npm 6 and earlier) isn't supported. " +
        "Upgrade it with `npm install --lockfile-version 3`.",
    );
  }
  if (version !== 2 && version !== 3) {
    throw new LockfileError(`Unsupported lockfileVersion: ${String(version)}.`);
  }

  const rawPackages = doc["packages"];
  if (!isObject(rawPackages)) {
    throw new LockfileError('The lockfile has no "packages" map.');
  }

  const entries = new Map<string, Entry>();
  for (const [location, raw] of Object.entries(rawPackages)) {
    entries.set(location, readEntry(location, raw));
  }

  const rootName =
    asString(doc["name"]) ?? entries.get("")?.name ?? "(project)";
  const paths = shortestPaths(entries, rootName);

  return { rootName, packages: collectPackages(entries, paths, rootName) };
}

function parseJson(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new LockfileError(`The lockfile isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(doc)) {
    throw new LockfileError("The lockfile isn't a JSON object.");
  }
  return doc;
}

/**
 * Reads one entry defensively. Lockfiles are untrusted input, so a field of
 * the wrong type is treated as missing rather than trusted.
 */
function readEntry(location: string, raw: unknown): Entry {
  if (!isObject(raw)) {
    throw new LockfileError(`The lockfile entry "${location}" isn't an object.`);
  }

  // devDependencies are installed only for the project and its workspaces.
  // For anything inside node_modules they are listed but never installed.
  const isProjectFolder = !isInstalled(location);
  const dependencyFields = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    ...(isProjectFolder ? ["devDependencies"] : []),
  ];
  const dependencies = dependencyFields.flatMap((field) => {
    const deps = raw[field];
    return isObject(deps) ? Object.keys(deps) : [];
  });

  return {
    name: asString(raw["name"]),
    version: asString(raw["version"]),
    resolved: asString(raw["resolved"]),
    integrity: asString(raw["integrity"]),
    link: raw["link"] === true,
    dev: raw["dev"] === true,
    inBundle: raw["inBundle"] === true,
    hasInstallScript: raw["hasInstallScript"] === true,
    dependencies,
  };
}

/**
 * Finds the shortest dependency path from the project to every reachable
 * location, with a breadth-first search over the dependency graph.
 *
 * Returns a map from location to path labels, such as
 * `["my-app", "some-lib@3.1.0", "example-utils@2.4.1"]`.
 */
function shortestPaths(
  entries: ReadonlyMap<string, Entry>,
  rootName: string,
): Map<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>([["", [rootName]]]);
  const queue = [""];

  // Workspace folders (and linked local folders) are part of the project, but
  // the root entry doesn't list them as dependencies. Start them one step
  // from the root so that their dependencies are reachable.
  for (const [location, entry] of entries) {
    if (location === "" || isInstalled(location)) continue;
    paths.set(location, [rootName, entry.name ?? location]);
    queue.push(location);
  }

  // Iterating while appending visits locations in breadth-first order, so the
  // first path recorded for a location is a shortest one.
  for (const location of queue) {
    const entry = entries.get(location);
    const pathHere = paths.get(location);
    if (entry === undefined || pathHere === undefined) continue;

    for (const dependency of entry.dependencies) {
      const target = resolveDependency(entries, location, dependency);
      if (target === undefined || paths.has(target)) continue;

      const targetEntry = entries.get(target);
      // A workspace folder already shows up as its own label; installed
      // packages are labelled name@version.
      const label = isInstalled(target)
        ? `${packageName(target, targetEntry)}@${targetEntry?.version ?? "?"}`
        : (targetEntry?.name ?? target);

      paths.set(target, [...pathHere, label]);
      queue.push(target);
    }
  }

  return paths;
}

/**
 * Finds where a dependency is installed, the way Node's module resolution
 * does: `<from>/node_modules/<name>`, then the same in each parent folder up
 * to the project root. Links (workspaces, `file:` folders) are followed to
 * their target.
 */
function resolveDependency(
  entries: ReadonlyMap<string, Entry>,
  from: string,
  name: string,
): string | undefined {
  let folder = from;
  for (;;) {
    const candidate = folder === "" ? `${NODE_MODULES}${name}` : `${folder}/${NODE_MODULES}${name}`;
    const entry = entries.get(candidate);
    if (entry !== undefined) {
      if (entry.link && entry.resolved !== undefined && entries.has(entry.resolved)) {
        return entry.resolved;
      }
      return candidate;
    }
    if (folder === "") return undefined;
    folder = parentFolder(folder);
  }
}

/**
 * The folder whose node_modules a location lives in:
 * `node_modules/a/node_modules/b` → `node_modules/a`, and
 * `node_modules/a` or `packages/web` → `""` (the project root).
 */
function parentFolder(location: string): string {
  const index = location.lastIndexOf(`/${NODE_MODULES}`);
  return index === -1 ? "" : location.slice(0, index);
}

/**
 * Builds one PackageNode per installed package.
 *
 * The same package can be installed at several locations. Those copies are
 * merged into one node keyed by name, version and source, which keeps the
 * shortest path, counts as a production dependency if any copy is one, and
 * has an install script if any copy does.
 */
function collectPackages(
  entries: ReadonlyMap<string, Entry>,
  paths: ReadonlyMap<string, readonly string[]>,
  rootName: string,
): PackageNode[] {
  const byIdentity = new Map<string, PackageNode>();

  for (const [location, entry] of entries) {
    // Only real installs are third-party code. Links point at folders that
    // are part of the project (or reachable on disk), not at downloads.
    if (!isInstalled(location) || entry.link) continue;

    const name = packageName(location, entry);
    const version = entry.version ?? "unknown";
    const node: PackageNode = {
      name,
      version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      hasInstallScript: entry.hasInstallScript,
      dev: entry.dev,
      bundled: entry.inBundle,
      // Packages nothing depends on (extraneous ones) have no path; show
      // them as if the project depended on them directly.
      path: paths.get(location) ?? [rootName, `${name}@${version}`],
    };

    const identity = `${name}@${version} ${entry.resolved ?? ""}`;
    const existing = byIdentity.get(identity);
    byIdentity.set(identity, existing === undefined ? node : mergeCopies(existing, node));
  }

  return [...byIdentity.values()];
}

function mergeCopies(a: PackageNode, b: PackageNode): PackageNode {
  const shorter = b.path.length < a.path.length ? b : a;
  return {
    ...shorter,
    dev: a.dev && b.dev,
    hasInstallScript: a.hasInstallScript || b.hasInstallScript,
    bundled: a.bundled && b.bundled,
  };
}

/**
 * The real package name. An entry's `name` field is present when the folder
 * name differs from the package (an `npm:` alias); otherwise the name is the
 * last `node_modules/` segment of the location, which keeps any `@scope/`.
 */
function packageName(location: string, entry: Entry | undefined): string {
  if (entry?.name !== undefined) return entry.name;
  return location.slice(location.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/** True for locations inside a node_modules folder. */
function isInstalled(location: string): boolean {
  return location.startsWith(NODE_MODULES) || location.includes(`/${NODE_MODULES}`);
}
