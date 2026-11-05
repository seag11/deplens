# deplens

Flag npm supply chain risks that `npm audit` misses, with an explanation for every finding.

`npm audit` reports versions with a published security advisory. A malicious version published an hour ago has no advisory yet, so it passes. deplens looks at how each dependency in your lockfile is installed and where it comes from. Each finding says what it saw, why that matters, and what to do about it.

**Status: early.** deplens reads `package-lock.json` (lockfileVersion 2 and 3) and checks two signals offline. Registry-based signals (very recent releases, a new publisher, dropped provenance), typosquatting and a GitHub Action come next; see [PLAN.md](PLAN.md).

## Usage

Requires Node.js 22.18 or later.

```console
$ npx deplens scan
deplens: 3 findings in 4 packages (1 high, 1 medium, 1 low)

DL002 unusual-source
  why  A version published to the npm registry can never be changed, and npm
       checks every download against the integrity hash in the lockfile. ...
  fix  Depend on a version published to the registry if one exists. ...

  HIGH    old-mirror-lib@0.9.0
          Downloaded over unencrypted http:
          http://mirror.example.com/old-mirror-lib/-/old-mirror-lib-0.9.0.tgz
          via risky-app > some-lib@2.0.0 > old-mirror-lib@0.9.0
...
```

| Option | Meaning |
|---|---|
| `[dir]` | Folder containing `package-lock.json` or `npm-shrinkwrap.json` (default: current folder) |
| `--fail-on <severity>` | Exit with code 1 if any finding is at least `low`, `medium` or `high` (default: `high`) |
| `--registry <url>` | A registry packages may come from. Repeat for several. Default: the public npm registry |
| `--json` | Print the report as JSON |

Exit codes: `0` nothing at or above `--fail-on`, `1` at least one finding at or above it, `2` an error.

## Signals

### DL001 install-script (low)

The package runs a preinstall, install or postinstall script. Install scripts run with your permissions as soon as a package is installed, on developer machines and in CI, which makes them the most common way malicious packages run their payload. Many legitimate packages use them to fetch or compile a native binary, so this is low severity on its own.

### DL002 unusual-source (medium or high)

The package doesn't come from a trusted registry with an integrity hash:

| Source | Severity | Why |
|---|---|---|
| Git repository | medium | No integrity hash, and npm runs the package's `prepare` script while installing it |
| Plain `http://` | high | The download can be altered in transit |
| Another host | high | Whoever controls that server can replace the tarball |
| Registry, but no integrity hash | high | npm can't detect tampering |

Local folders and tarballs (`file:`) are part of your project, so they aren't flagged. If you use a private registry, pass it with `--registry`.

## Development

```sh
npm ci --ignore-scripts
npm run check    # type-check and run the tests
npm run build    # compile to dist/
```

The tests run the TypeScript sources directly with Node's built-in type stripping.

The code is organised around one rule: rules are pure functions. The CLI reads the lockfile, `analyze()` parses it and runs each rule on each package, and the reporters format the result. No rule touches the network or the file system, so each one is tested with plain objects.

```
src/
  types.ts       shared types; no logic
  lockfile.ts    package-lock.json → packages, with dependency paths
  rules/         one file per rule, listed in rules/index.ts
  analyze.ts     runs the rules and orders the findings
  report.ts      text and JSON output
  cli.ts         arguments, files, exit codes
  bin.ts         the executable
```

## License

MIT
