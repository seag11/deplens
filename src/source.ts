/**
 * Works out where a package was downloaded from, using the lockfile's
 * `resolved` field.
 *
 * Shared by the unusual-source rule (DL002), which flags anything but a
 * trusted registry, and by the engine, which fetches registry metadata only
 * for packages that came from a registry.
 */

/** Where a package's `resolved` field says it came from. */
export type Source =
  /** A configured registry. `host` is undefined when `resolved` was left out. */
  | { readonly kind: "registry"; readonly host: string | undefined }
  /** A folder or tarball inside the project. */
  | { readonly kind: "local" }
  | { readonly kind: "git"; readonly url: string }
  /** Plain http. */
  | { readonly kind: "insecure"; readonly url: string }
  /** Any host that isn't a configured registry. */
  | { readonly kind: "other-host"; readonly host: string; readonly url: string };

/** Prefixes npm uses for git dependencies, including hosted shorthands. */
const GIT_PREFIXES = ["git+", "git:", "git@", "github:", "gitlab:", "bitbucket:", "gist:"];

/**
 * Classifies a lockfile `resolved` value. URLs in the result have any
 * embedded password hidden, so they are safe to print.
 *
 * A missing value counts as the registry: npm leaves it out when the
 * `omit-lockfile-registry-resolved` setting is on, and then installs from
 * whichever registry is configured.
 */
export function classifySource(resolved: string | undefined, registryHosts: ReadonlySet<string>): Source {
  if (resolved === undefined) return { kind: "registry", host: undefined };

  if (GIT_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
    return { kind: "git", url: redact(resolved) };
  }

  // npm records `file:` dependencies as relative paths, which aren't URLs.
  if (!URL.canParse(resolved)) return { kind: "local" };

  const url = new URL(resolved);
  if (url.protocol === "file:") return { kind: "local" };
  if (url.protocol === "http:") return { kind: "insecure", url: redact(resolved) };
  if (url.protocol === "https:" && registryHosts.has(url.host)) return { kind: "registry", host: url.host };
  return { kind: "other-host", host: url.host, url: redact(resolved) };
}

/**
 * Hides any password embedded in a URL, so credentials in a lockfile never
 * end up in CI logs.
 */
function redact(value: string): string {
  if (!URL.canParse(value)) return value;
  const url = new URL(value);
  if (url.password === "") return value;
  url.password = "***";
  return url.toString();
}
