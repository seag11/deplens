import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpRegistryClient, packumentUrl, RegistryError } from "../src/registry.ts";

const PACKUMENT = { name: "some-lib", versions: { "1.0.0": {} }, time: { "1.0.0": "2026-01-01T00:00:00Z" } };

/**
 * A fake fetch that answers from a queue of responses, one per call, and
 * records the URLs it was asked for.
 */
function fakeFetch(...responses: Array<Response | Error>) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A client that retries immediately, so tests don't wait. */
const client = (fetch: typeof globalThis.fetch) => new HttpRegistryClient({ fetch, retryDelayMs: 0 });

describe("packumentUrl", () => {
  it("encodes scoped names the way npm does", () => {
    assert.equal(packumentUrl("@scope/pkg", "https://registry.npmjs.org/"), "https://registry.npmjs.org/@scope%2Fpkg");
  });

  it("keeps a registry's path, with or without a trailing slash", () => {
    for (const registry of ["https://npm.corp.example/api/npm/", "https://npm.corp.example/api/npm"]) {
      assert.equal(packumentUrl("some-lib", registry), "https://npm.corp.example/api/npm/some-lib");
    }
  });
});

describe("HttpRegistryClient", () => {
  it("fetches and parses a packument", async () => {
    const { fetch, urls } = fakeFetch(json(PACKUMENT));
    const packument = await client(fetch).packument("some-lib", "https://registry.npmjs.org/");
    assert.equal(packument?.versions[0]?.version, "1.0.0");
    assert.deepEqual(urls, ["https://registry.npmjs.org/some-lib"]);
  });

  it("resolves to undefined for a package the registry doesn't have", async () => {
    const { fetch } = fakeFetch(json({ error: "Not found" }, 404));
    assert.equal(await client(fetch).packument("missing", "https://registry.npmjs.org/"), undefined);
  });

  it("retries once when rate limited, honouring Retry-After", async () => {
    const { fetch, urls } = fakeFetch(json({}, 429, { "retry-after": "0" }), json(PACKUMENT));
    const packument = await client(fetch).packument("some-lib", "https://registry.npmjs.org/");
    assert.ok(packument);
    assert.equal(urls.length, 2);
  });

  it("gives up after the retry", async () => {
    const { fetch } = fakeFetch(json({}, 503), json({}, 503));
    await assert.rejects(client(fetch).packument("some-lib", "https://registry.npmjs.org/"), RegistryError);
  });

  it("doesn't retry other errors", async () => {
    const { fetch, urls } = fakeFetch(json({}, 401));
    await assert.rejects(client(fetch).packument("private", "https://registry.npmjs.org/"), /HTTP 401/);
    assert.equal(urls.length, 1);
  });

  it("reports network failures and unusable responses as RegistryError", async () => {
    const offline = fakeFetch(new TypeError("fetch failed"));
    await assert.rejects(client(offline.fetch).packument("a", "https://registry.npmjs.org/"), /Couldn't reach/);

    const notJson = fakeFetch(new Response("<html>", { status: 200 }));
    await assert.rejects(client(notJson.fetch).packument("a", "https://registry.npmjs.org/"), /valid JSON/);

    const notPackument = fakeFetch(json({ hello: "world" }));
    await assert.rejects(client(notPackument.fetch).packument("a", "https://registry.npmjs.org/"), /package metadata/);
  });

  it("keeps at most `concurrency` requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return json(PACKUMENT);
    }) as typeof globalThis.fetch;

    const limited = new HttpRegistryClient({ fetch, concurrency: 3 });
    const names = Array.from({ length: 12 }, (_, i) => `pkg-${i}`);
    await Promise.all(names.map((name) => limited.packument(name, "https://registry.npmjs.org/")));
    assert.equal(peak, 3);
  });
});
