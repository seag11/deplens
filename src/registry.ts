/**
 * Fetches package metadata from npm registries.
 *
 * The engine depends only on the RegistryClient interface. HttpRegistryClient
 * is the real implementation; tests pass a fake that returns fixtures, so no
 * test touches the network.
 */

import { parsePackument, type Packument } from "./packument.ts";

/** Something that can look up a package's registry metadata. */
export interface RegistryClient {
  /**
   * Fetches the packument for `name` from the registry at `registryUrl`.
   * Resolves to undefined if the registry has no such package.
   *
   * @throws RegistryError if the registry can't be reached or answers with an error.
   */
  packument(name: string, registryUrl: string): Promise<Packument | undefined>;
}

/** A registry request failed. */
export class RegistryError extends Error {
  override name = "RegistryError";
}

export interface HttpRegistryOptions {
  /** The fetch implementation. Defaults to the global fetch; tests pass a fake. */
  readonly fetch?: typeof fetch;
  /** Most requests in flight at once. Defaults to 8, to be polite to the registry. */
  readonly concurrency?: number;
  /** Per-request timeout. Defaults to 30 seconds, since full packuments can be large. */
  readonly timeoutMs?: number;
  /** Wait before the single retry when the registry gives no Retry-After. Defaults to 1 second. */
  readonly retryDelayMs?: number;
}

/** Longest Retry-After deplens honours, so a misbehaving server can't stall a scan. */
const MAX_RETRY_DELAY_MS = 30_000;

/**
 * A RegistryClient that talks HTTP. It caps the number of concurrent
 * requests, and retries once when the registry is rate limiting (429) or
 * briefly failing (5xx).
 */
export class HttpRegistryClient implements RegistryClient {
  readonly #fetch: typeof fetch;
  readonly #limit: Limiter;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;

  constructor(options: HttpRegistryOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#limit = createLimiter(options.concurrency ?? 8);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  packument(name: string, registryUrl: string): Promise<Packument | undefined> {
    const url = packumentUrl(name, registryUrl);
    return this.#limit(() => this.#get(url));
  }

  async #get(url: string): Promise<Packument | undefined> {
    let response = await this.#request(url);
    if (response.status === 429 || response.status >= 500) {
      await sleep(retryDelay(response, this.#retryDelayMs));
      response = await this.#request(url);
    }

    if (response.status === 404) return undefined;
    if (!response.ok) throw new RegistryError(`${url} answered HTTP ${response.status}`);

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new RegistryError(`${url} didn't return valid JSON: ${(error as Error).message}`);
    }
    const packument = parsePackument(json);
    if (packument === undefined) throw new RegistryError(`${url} didn't return package metadata`);
    return packument;
  }

  async #request(url: string): Promise<Response> {
    try {
      return await this.#fetch(url, {
        headers: { accept: "application/json", "user-agent": "deplens" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new RegistryError(`Couldn't reach ${url}: ${(error as Error).message}`, { cause: error });
    }
  }
}

/**
 * The packument URL for a package. Scoped names keep their `@` and encode
 * the slash (`@scope%2Fname`), as npm itself does. The registry URL may have
 * a path, as private registries often do, and the name is appended to it.
 */
export function packumentUrl(name: string, registryUrl: string): string {
  const base = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  return new URL(encoded, base).toString();
}

/**
 * How long to wait before retrying: the server's Retry-After if it gives a
 * number of seconds, otherwise the fallback. (Retry-After can also be a
 * date, which is rare enough to treat as missing.)
 */
function retryDelay(response: Response, fallbackMs: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_DELAY_MS) : fallbackMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs async tasks with at most a fixed number in flight at once. */
type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async (task) => {
    if (active < max) {
      active += 1;
    } else {
      // Wait for a finishing task to hand over its slot.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      // Pass the slot straight to the next waiting task, if there is one.
      // Releasing it first would let a newly arriving task take it as well,
      // briefly exceeding the limit.
      const next = waiting.shift();
      if (next === undefined) active -= 1;
      else next();
    }
  };
}
