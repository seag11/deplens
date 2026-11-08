# deplens: project plan

An npm supply chain risk analyzer. Point it at a project with a `package-lock.json` and it flags risk signals that `npm audit` misses. `npm audit` only reports versions with a published advisory, so a malicious version published an hour ago passes. deplens looks at how each dependency was published and where it comes from, and explains every finding in plain language.

```
package-lock.json ──► parse ──► packages ──► (diff against base) ──► rules ──► findings ──► report
                                                                      ▲
                                                     registry metadata (optional)
```

Example output:

```
$ deplens scan --base origin/main
deplens: 1 finding in 14 changed packages (1,203 total)

HIGH  DL006 provenance-dropped  example-utils@2.4.1
  2.4.0 and the 11 versions before it carry npm provenance from GitHub Actions. 2.4.1 has none.
  why:  A version published with a stolen npm token can't carry a provenance attestation
        from the project's CI. This is what an account takeover looks like from outside.
  via:  my-app > some-lib@3.1.0 > example-utils@2.4.1
  fix:  Pin example-utils to 2.4.0 and check the project's repository before upgrading.
```

## Why it's worth building

- **Timely.** The large npm compromises of recent years, including self-spreading attacks that hijacked maintainer accounts, shipped as fresh versions of packages people already trusted. None had an advisory when it landed.
- **Different signals catch different attacks.** Most large compromises came from an attacker gaining publishing access to a trusted package: a phished maintainer, a stolen token, or a hijacked CI workflow. Many ran their payload from an install script added to the new version. Others hid it in the library code itself, where an install-script check sees nothing but a check for very recent releases still fires. The README should say this plainly.
- **Explainable.** deplens is a small, open tool where every finding names the facts that triggered it and says why they matter.
- **Pairs with the CI secret scanner.** Stealing CI and npm tokens is a common goal of these attacks, and stolen tokens are how they spread. The two make a "protect your pipeline" pair of GitHub Actions.

## Principles

1. **Small first.** Six signals done well beat fifteen done loosely. New signals get added when the evaluation shows a gap, not before.
2. **Rules are pure functions.** Rules never do I/O. They take a package plus its metadata and return findings, which keeps them easy to test and lets the tool run offline.
3. **Every finding explains itself.** Each one shows the evidence, why it matters, how to fix it, and the dependency path that pulled the package in. No risk scores.
4. **Diff first.** In CI the question is "what did this PR add?" Scanning only changed packages keeps the noise and the number of registry requests low.
5. **Practise what it preaches.** Zero runtime dependencies. Published with npm provenance. Scans its own lockfile in CI.

## Signals

Six rules. IDs are stable, so ignores and links never break.

| ID | Name | Needs | Fires when | Severity |
|---|---|---|---|---|
| DL001 | `install-script` | lockfile; registry to escalate | The lockfile marks the package `hasInstallScript` (preinstall, install or postinstall) | low; high if the previous version had no install script, or this version is less than 3 days old |
| DL002 | `unusual-source` | lockfile | `resolved` is a git URL, uses `http://`, or points at a host that isn't a configured registry; or there's no `integrity` hash | medium for git; high otherwise |
| DL003 | `typosquat` | bundled list | The name is one or two edits away from a popular package | high |
| DL004 | `recent-release` | registry | This version was published less than 3 days ago | medium |
| DL005 | `new-publisher` | registry | The npm account that published this version (`_npmUser`) never published an earlier version | low |
| DL006 | `provenance-dropped` | registry | Earlier versions have provenance attestations and this one doesn't | high |

Install scripts are common in legitimate packages (native binaries, compilers), so DL001 is informational unless the script is new or the version is brand new. The default `--fail-on high` stops a build only on the strongest signals. For pull-request scans the README recommends `--fail-on medium`, which turns DL004 into a cooldown gate: a version published in the last 3 days fails the check until it has had time to be noticed and pulled if it's malicious.

Checked against recent large compromises, the defaults should fail CI on an install script added to a fresh version, on a missing provenance attestation, and on a typosquatted dependency slipped into a new release. A payload hidden in library code, with no install script, is caught only by DL004, which is why the medium threshold is the recommended one for pull requests.

### Notes

**Install scripts (DL001).** The strongest sign of a self-spreading attack is an install script appearing in a package that never had one: worms republish each victim's other packages with a script added, and legitimate packages almost never add one in a patch release. With registry metadata, DL001 compares this version's `scripts` (preinstall, install, postinstall) and `gypfile` with the version published just before it, and reports `high` if the earlier version had none. It also reports `high` when the version is less than 3 days old, since a fresh version that runs code on install is the most common shape of a compromised release. Offline, or for a package's first version, it stays `low`. The message says which case applies.

**Recent releases (DL004)** is the one signal that fires for every recent large compromise, because malicious versions are usually found and pulled within hours to a few days. Waiting a few days before installing a new version (a cooldown) is now standard advice, and the major package managers have a setting for it. DL004's fix text should point to those settings (`min-release-age` in npm, `minimumReleaseAge` in pnpm), so the cause gets fixed and not only reported.

**"Recent maintainer changes" becomes DL005.** The registry exposes only the current maintainer list, with no history. Each version does record who published it, so "published by an account that never released this package before" can be computed from one metadata request. Two caveats keep it at `low`:

- It targets handover attacks, where a new person is given publishing rights. It doesn't catch stolen accounts or tokens, because those publish as the real maintainer. The README should say so.
- Projects moving to trusted publishing start publishing as npm's OIDC identity instead of a person. That is a security improvement, not a risk, so a version published through trusted publishing doesn't count as a new publisher.

**Typosquatting (DL003).** Compare against a bundled list of the top ~5,000 packages by weekly downloads, regenerated by a script. Use Damerau-Levenshtein distance (it counts swapped letters as one edit): distance 1 for names of up to 8 characters, 2 for longer ones. Also compare with separators removed, so `some-lib` matches `somelib`. Skip the check when the name is itself on the popular list. Use the real package name, not the lockfile key, since `npm:` aliases can make them differ.

**Provenance (DL006)** reads `dist.attestations` from the version metadata. It's one of the strongest signals available, because a stolen token can publish a version but can't produce the project's CI attestation. It isn't a guarantee: an attacker who hijacks the project's own CI workflow publishes with a valid attestation, so the README must not present provenance as proof that a version is safe. DL001 and DL004 still fire in that case.

## Architecture

A handful of modules with one rule: rules don't do I/O. The registry client and the clock are passed in, so tests use recorded responses and a fixed date.

```
src/
  types.ts          PackageNode, Finding, Rule, RuleContext, Report
  lockfile.ts       package-lock v2/v3 → PackageNode[] (with shortest dependency path)
  source.ts         where a package was downloaded from (shared by DL002 and the engine)
  packument.ts      registry metadata → the few fields rules read, plus pure queries
  registry.ts       RegistryClient interface + HTTP implementation (the only network I/O)
  edit-distance.ts  bounded Damerau-Levenshtein distance
  json.ts           helpers for reading untrusted JSON
  diff.ts           base vs head → added or changed packages (milestone 4)
  rules/            one file per rule, plus index.ts listing them; recency.ts is shared
  analyze.ts        parse → (diff) → fetch metadata → run rules → (apply ignores)
  report.ts         text and JSON output; Markdown for the Action summary (milestone 4)
  cli.ts            node:util parseArgs, exit codes
  action.ts         GitHub Action entry point (milestone 4)
data/popular.json   (milestone 2, from the separate list project)
test/
```

### Core types

```ts
type Severity = "low" | "medium" | "high";

interface PackageNode {
  name: string;          // real name, after npm: alias resolution
  version: string;
  resolved?: string;
  integrity?: string;
  hasInstallScript: boolean;
  dev: boolean;
  bundled: boolean;      // ships inside its parent's tarball
  path: string[];        // shortest chain from the root
}

interface Rule {
  id: string;            // "DL006"
  name: string;          // "provenance-dropped"
  why: string;           // written once, shown with the rule's findings
  fix: string;
  check(pkg: PackageNode, ctx: RuleContext): Match | undefined;   // pure
}

interface Match {        // what a rule saw; the engine adds rule, package and path
  severity: Severity;
  message: string;       // one line, with specifics
  evidence: Record<string, string | number | boolean>;
}

interface Finding {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  package: { name: string; version: string };
  message: string;
  evidence: Record<string, string | number | boolean>;
  via: string[];
}

function analyze(input: AnalyzeInput): Report;   // { packageCount, findings }
```

Rules return at most one `Match` per package, and the engine turns it into a `Finding`. `why` and `fix` live on the rule, not on each finding, so the explanation is written once.

`RuleContext` carries the analysis time (`now`) and this package's registry metadata (`packument`, undefined when offline or unavailable), so rules never read the clock or the network. Each rule declares `needsRegistry`, and `analyze()` is async and accepts a `RegistryClient` and a `now`.

With no registry client (`--offline`), the three registry rules are skipped and the report's `warnings` say so. DL001 still runs, without its escalation. Packages whose metadata can't be fetched are checked offline and listed in a warning, so a quiet report is never mistaken for a complete one. Metadata is fetched once per package name, only for packages that came from a registry, from the registry the package was downloaded from. There is no disk cache: diff mode keeps request counts small enough not to need one.

Full packuments are needed, because the abbreviated format leaves out publish times and publishers. They can be several megabytes for packages with long histories.

### Interface

```
deplens scan [dir] [--base GIT_REF] [--offline] [--json] [--fail-on low|medium|high] [--registry URL]...
```

`--registry` lists the registries packages may come from (default: the public npm registry), so teams using a private registry don't see every package flagged.

`--base` reads the base lockfile with `git show REF:package-lock.json` and scans only packages that are new or changed. Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above it, `2` error.

Ignores go in an optional `.deplens.json`, and each one needs a reason:

```json
{ "ignore": [{ "rule": "DL002", "package": "internal-lib", "reason": "Our own git-hosted package" }] }
```

The GitHub Action wraps the same `analyze()`. In a pull request it diffs against the base branch automatically and writes a Markdown table to the job summary:

```yaml
- uses: seag11/deplens@v1
  with:
    fail-on: medium   # recommended for pull requests: enforces the 3-day cooldown
```

## Technology

TypeScript on Node ≥ 22.18 with zero runtime dependencies: `fetch`, `node:util` `parseArgs`, `node:test` and `node:fs` cover everything. Tests run the `.ts` sources directly with Node's built-in type stripping, so the code sticks to syntax Node can strip (`erasableSyntaxOnly`). Since there are no runtime dependencies, the Action can run the compiled `tsc` output directly, with no bundler. The only dev dependencies are `typescript` and `@types/node` (pinned to the oldest supported Node line).

## Testing

- **Rules:** a table of cases per rule, built from plain objects. Rules are pure, so no mocks.
- **Lockfile parser:** a few real lockfiles as fixtures (a small app, a workspaces monorepo, an `npm:` alias, a git dependency).
- **analyze():** end-to-end with a fake `RegistryClient` that reads recorded JSON from `test/fixtures/registry/`, and a fixed date. No network.
- **Attack shapes:** one synthetic fixture per pattern, checking which rules fire and that the default and recommended thresholds give the expected result:
  - a stolen token publishing a patch release that adds an install script, with no provenance
  - a hijacked CI workflow publishing with valid provenance and an install script
  - a payload in library code, with no install script
  - a new release that adds a typosquatted dependency
  - a git-hosted dependency
  - a legitimate project switching to trusted publishing (should stay quiet)

## Evaluation

As with dgalens, publish numbers, not adjectives. Add the results table to the README.

- **Noise:** scan the lockfiles of ~10 popular open source projects and count findings per severity. Target: no high findings on a clean lockfile.
- **Typosquats:** recall on npm names from the OpenSSF [malicious-packages](https://github.com/ossf/malicious-packages) dataset; false positives on the top 10,000 npm names.

## Milestones

Each one is a complete stopping point.

1. **Offline core (1–2 weekends). Done.** Lockfile parser, DL001–DL002, text and JSON output, the `scan` CLI with `--fail-on` and `--registry`, CI that runs the tests and scans deplens itself.
2. **Typosquatting (1 weekend).** In three steps:
   1. *Done.* Edit distance with an early exit at the limit, and the DL003 rule, with the popular list passed in as an input. A worst-case full scan (1,500 packages against 5,000 names) takes about 1.2 s.
   2. Bundle a list of popular packages and use it by default. *Waiting on a separate project:* existing lists are built from share-alike (CC BY-SA) data, so the list will come from a separate MIT-licensed repository that crawls npm's registry and downloads API directly. deplens copies the published list in with an update script, keeping zero runtime dependencies.
   3. The typosquat evaluation, once the list exists.
3. **Registry rules (1–2 weekends). Done.** Registry client (8 concurrent requests, one retry on 429 or 5xx, 30 s timeout), DL004–DL006, DL001's escalation, DL005's trusted-publishing exception, `--offline`, warnings when registry checks couldn't run, a recorded registry fixture, and the attack-shape scenarios. An online scan of a 132-package project takes about 2.5 s.
4. **Diff and Action (1 weekend).** `--base`, `.deplens.json` ignores, `action.yml`, job summary.
5. **Release (1 weekend).** README with one section per signal and the evaluation results, npm release with provenance, `v1` tag.

## Later, if the evaluation or users call for it

- More signals: suspicious install-script contents, a dependency added in a patch release, packages less than a month old, a release after a long period with no releases, a published tarball that doesn't match the source repository.
- SARIF output for GitHub code scanning.
- `pnpm-lock.yaml` and `yarn.lock`.
- A disk cache for full-tree scans.

## Non-goals

- **Known vulnerabilities.** `npm audit` covers those. Recommend running it alongside deplens.
- **Running packages.** deplens never executes dependency code.
- **Risk scores or verdicts.** It flags things for a human to look at, with the evidence.

## Risks

- **Too many false alarms** is the main threat to adoption. Mitigated by diff mode, low severity for common signals, and measuring noise before release.
- **Lockfile quirks** (workspaces, links, aliases). Mitigated by testing against real lockfiles.
- **DL005 noise from organisation-wide publisher changes.** First real data point: scanning deplens's own lockfile gives 21 `low` DL005 findings, because the TypeScript project moved all of its packages to a new organisation publishing account. Accurate, but one event produces many near-identical findings. It doesn't fail CI, and diff mode will show it only on the pull request that upgrades those packages. Measure it in the noise evaluation before deciding whether DL005 or the report needs to change.
- **Overstating what's caught.** No signal catches every attack: provenance can come from a hijacked pipeline, and stolen accounts publish as their owners. Mitigated by a README that says which attack shapes each signal does and doesn't catch, backed by the attack-shape fixtures.
- **Overlap with package-manager cooldowns.** npm and pnpm can now refuse very new versions themselves. deplens still adds value by explaining the finding and by enforcing it in CI regardless of each developer's local settings, and DL004's fix text recommends turning the setting on.
- **Package name.** Check that `deplens` is free on npm before release, and fall back to `@seag11/deplens` if it isn't.
