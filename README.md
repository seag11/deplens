# deplens

Flag npm supply chain risks that `npm audit` misses, with an explanation for every finding.

`npm audit` reports versions with a published security advisory. A malicious version published an hour ago has no advisory yet, so it passes. deplens looks at how each dependency in your lockfile is installed, where it comes from and how it was published. Each finding says what it saw, why that matters, and what to do about it.

**Status: early.** deplens reads `package-lock.json` (lockfileVersion 2 and 3), checks it offline, and checks registry metadata for each package. Scanning only what a pull request changed and a GitHub Action come next, and the typosquat check is waiting on a list of popular packages; see [PLAN.md](PLAN.md).

## Usage

Requires Node.js 22.18 or later.

```console
$ npx deplens scan --fail-on medium
deplens: 2 findings in 412 packages (1 high, 1 medium)

DL001 install-script
  why  Install scripts (preinstall, install, postinstall) run with your
       permissions as soon as the package is installed, ...
  fix  Check that the package needs its install script. ...

  HIGH    some-lib@1.4.2
          Runs postinstall "node setup.js"; 1.4.1 didn't have one; this version
          was published 5 hours ago
          via my-app > other-lib@3.0.0 > some-lib@1.4.2

DL004 recent-release
  ...
```

| Option | Meaning |
|---|---|
| `[dir]` | Folder containing `package-lock.json` or `npm-shrinkwrap.json` (default: current folder) |
| `--fail-on <severity>` | Exit with code 1 if any finding is at least `low`, `medium` or `high` (default: `high`) |
| `--registry <url>` | A registry packages may come from. Repeat for several. Default: the public npm registry |
| `--offline` | Don't contact the registry. The checks that need registry metadata are skipped, and the report says so |
| `--json` | Print the report as JSON |

Exit codes: `0` nothing at or above `--fail-on`, `1` at least one finding at or above it, `2` an error.

**Which threshold?** The default, `high`, fails only on the strongest signals. For pull requests, `--fail-on medium` is recommended: it also fails on versions published in the last 3 days, which works as a cooldown and is the only check that catches a payload hidden in a package's library code.

Online, deplens downloads each package's full registry metadata (up to a few megabytes for packages with long histories), 8 requests at a time. If some metadata can't be fetched, those packages are still checked offline and the report lists them.

## Signals

No single signal catches every attack, so deplens checks several. Most large npm compromises came from an attacker gaining publishing access to a trusted package (a phished maintainer, a stolen token, or a hijacked CI workflow) and publishing a fresh version, often with an install script added. The test suite includes a scenario for each of these attack shapes, recording what is caught at each threshold.

| ID | Name | Needs | Severity |
|---|---|---|---|
| DL001 | install-script | lockfile; registry to escalate | low, or high when the script is new or the version is fresh |
| DL002 | unusual-source | lockfile | medium or high |
| DL003 | typosquat | a list of popular packages | high |
| DL004 | recent-release | registry | medium |
| DL005 | new-publisher | registry | low |
| DL006 | provenance-dropped | registry | high |

### DL001 install-script

The package runs a preinstall, install or postinstall script (or builds a native addon). Install scripts run with your permissions as soon as a package is installed, on developer machines and in CI, which makes them the most common way malicious packages run their payload. Many legitimate packages use them to fetch or compile a native binary, so this is `low` on its own.

With registry metadata, the finding shows the script itself, and is `high` when:

- **the script is new**: the version published just before had none. Self-spreading attacks republish a victim's other packages with a script added, and legitimate packages rarely add one.
- **the version is fresh**: published less than 3 days ago, so a malicious script hasn't had time to be noticed.

### DL002 unusual-source

The package doesn't come from a trusted registry with an integrity hash:

| Source | Severity | Why |
|---|---|---|
| Git repository | medium | No integrity hash, and npm runs the package's `prepare` script while installing it |
| Plain `http://` | high | The download can be altered in transit |
| Another host | high | Whoever controls that server can replace the tarball |
| Registry, but no integrity hash | high | npm can't detect tampering |

Local folders and tarballs (`file:`) are part of your project, so they aren't flagged. If you use a private registry, pass it with `--registry`.

### DL003 typosquat

The name is the same as a popular package's apart from separators (`some-lib` and `somelib`), or one or two typos away from it (two only for names longer than 8 characters). Names under 4 characters, and packages that are popular themselves, are never flagged.

**Off by default for now:** the check needs a bundled list of popular packages, which isn't built yet.

### DL004 recent-release

The version was published less than 3 days ago. Compromised versions are usually found and pulled within hours to days, so waiting a few days avoids most of them, including those whose payload is in the library code where no other check can see it. This is the check that `--fail-on medium` turns into a cooldown.

To wait automatically everywhere, also set a minimum release age in your package manager: `min-release-age` (in days) in npm's `.npmrc`, or `minimumReleaseAge` (in minutes) in pnpm.

### DL005 new-publisher

The version was published in the last 90 days by an npm account that never published an earlier version. That can mean the package changed hands, which is how some attacks begin. It is `low` because projects also change publishers for ordinary reasons, such as a new maintainer or a move to an organisation account. Versions published through trusted publishing (by the project's CI) never count as a new publisher.

Older versions aren't flagged: a release that has been public for months without being pulled has had time to be scrutinised, and flagging it would mostly repeat ordinary maintainer changes from long ago.

**What it doesn't catch:** stolen accounts and tokens publish as the real maintainer, so they look like any other release here. DL001, DL004 and DL006 cover those.

### DL006 provenance-dropped

The version published before this one had a provenance attestation (a signed record of the CI workflow that built it), and this one doesn't. A release published with a stolen token can't produce the project's attestation, so a gap is a strong sign of a release that didn't come from the project's CI.

**What it doesn't catch:** an attacker who hijacks the project's own CI workflow publishes with valid provenance. Provenance shows where a version was built, not that it is safe.

## Development

```sh
npm ci --ignore-scripts
npm run check    # type-check and run the tests
npm run build    # compile to dist/
```

The tests run the TypeScript sources directly with Node's built-in type stripping, and never touch the network: the registry client is replaced by a fake, and the clock by a fixed date.

The code is organised around one rule: rules are pure functions. The CLI reads the lockfile, `analyze()` parses it, fetches registry metadata through a `RegistryClient` and runs each rule on each package, and the reporters format the result. No rule touches the network, the file system or the clock, so each one is tested with plain objects.

```
src/
  types.ts          shared types; no logic
  lockfile.ts       package-lock.json → packages, with dependency paths
  source.ts         where a package was downloaded from
  packument.ts      registry metadata → the few fields the rules read
  registry.ts       the RegistryClient interface and its HTTP implementation
  edit-distance.ts  name similarity, for the typosquat check
  rules/            one file per rule, listed in rules/index.ts
  analyze.ts        fetches metadata, runs the rules, orders the findings
  report.ts         text and JSON output
  cli.ts            arguments, files, exit codes
  bin.ts            the executable
```

## License

MIT
