import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeMarkdown, formatMarkdown } from "../src/report/markdown.ts";
import { installScript } from "../src/rules/install-script.ts";
import type { Finding, Report } from "../src/types.ts";

const scriptFinding: Finding = {
  ruleId: "DL001",
  ruleName: "install-script",
  severity: "high",
  package: { name: "some-lib", version: "1.4.2" },
  message: 'Runs postinstall "node setup.js || true"; 1.4.1 didn\'t have one',
  evidence: {},
  via: ["my-app", "other-lib@3.0.0", "some-lib@1.4.2"],
};

const report = (overrides: Partial<Report> = {}): Report => ({
  packageCount: 412,
  changedCount: 14,
  findings: [scriptFinding],
  ignored: [],
  warnings: [],
  ...overrides,
});

/** Text a hostile package could put in a name, a script or a publisher name. */
const HOSTILE = "evil | [click here](https://phish.example) ![](https://track.example/p.png) <img src=x onerror=alert(1)> **bold**\nnew line";

/** True when every ASCII punctuation character in `text` is backslash-escaped. */
function isFullyEscaped(text: string): boolean {
  return /^(?:\\[!-/:-@[-`{-~]|[^!-/:-@[-`{-~])*$/.test(text);
}

describe("escapeMarkdown", () => {
  it("escapes every ASCII punctuation character, so nothing renders as Markdown or HTML", () => {
    const escaped = escapeMarkdown(HOSTILE);
    assert.ok(isFullyEscaped(escaped), escaped);
    assert.doesNotMatch(escaped, /(?<!\\)[[\]()<>|*]/);
  });

  it("shows line breaks as visible escapes, so a table row can't be ended early", () => {
    const escaped = escapeMarkdown("a\nb\r\nc");
    assert.doesNotMatch(escaped, /[\n\r]/);
    // \u{A} with its backslash and braces escaped for Markdown.
    assert.equal(escaped, "a\\\\u\\{A\\}b\\\\u\\{D\\}\\\\u\\{A\\}c");
  });

  it("makes control and invisible characters visible", () => {
    assert.doesNotMatch(escapeMarkdown("a\u001b[31mb‮c"), /[\u001b‮]/);
  });

  it("leaves letters, digits and spaces alone", () => {
    assert.equal(escapeMarkdown("Published 5 hours ago"), "Published 5 hours ago");
    assert.equal(escapeMarkdown("some-lib@1.4.2"), "some\\-lib\\@1\\.4\\.2");
  });
});

describe("formatMarkdown", () => {
  it("starts with a heading and the summary", () => {
    const lines = formatMarkdown(report()).split("\n");
    assert.deepEqual(lines.slice(0, 3), ["### deplens", "", "1 finding in 14 changed packages of 412 (1 high)"]);
  });

  it("lists each finding as a table row, with its dependency path", () => {
    const markdown = formatMarkdown(report());
    assert.match(markdown, /^\| Severity \| Rule \| Package \| Finding \|$/m);
    const row = markdown.split("\n").find((line) => line.startsWith("| **HIGH**"));
    assert.ok(row);
    assert.match(row, /\| DL001 install-script \| some\\-lib\\@1\\\.4\\\.2 \|/);
    assert.match(row, /<br>via my\\-app › other\\-lib\\@3\\\.0\\\.0 › some\\-lib\\@1\\\.4\\\.2 \|$/);
  });

  it("keeps a script containing | inside its table cell", () => {
    const row = formatMarkdown(report()).split("\n").find((line) => line.startsWith("| **HIGH**"))!;
    // Five unescaped pipes: the borders of four cells.
    assert.equal(row.match(/(?<!\\)\|/g)?.length, 5);
  });

  it("explains each rule that fired once, in a collapsed section", () => {
    const markdown = formatMarkdown(report({ findings: [scriptFinding, { ...scriptFinding, package: { name: "b", version: "1.0.0" } }] }));
    assert.match(markdown, /<details>\n<summary>About these checks<\/summary>/);
    assert.equal(markdown.split(installScript.why).length - 1, 1);
    assert.match(markdown, new RegExp(`What to do: ${escapeRegExp(installScript.fix)}`));
  });

  it("lists accepted findings and notes", () => {
    const markdown = formatMarkdown(
      report({
        findings: [],
        ignored: [{ ...scriptFinding, ignoreReason: "Reviewed the script" }],
        warnings: ["Offline: skipped DL004 recent-release."],
      }),
    );
    assert.match(markdown, /\*\*Accepted findings\*\* \(not counted\)\n\n- DL001 some\\-lib\\@1\\\.4\\\.2: Reviewed the script/);
    assert.match(markdown, /\*\*Notes\*\*\n\n- Offline\\: skipped DL004 recent\\-release\\\./);
    assert.doesNotMatch(markdown, /\| Severity \|/);
  });

  it("renders values from outside deplens as plain text", () => {
    const hostile: Finding = {
      ...scriptFinding,
      package: { name: HOSTILE, version: HOSTILE },
      message: HOSTILE,
      via: [HOSTILE, HOSTILE],
    };
    const markdown = formatMarkdown(
      report({
        findings: [hostile],
        ignored: [{ ...hostile, ignoreReason: HOSTILE }],
        warnings: [HOSTILE],
      }),
    );
    // No link, image or HTML from the hostile value survives unescaped.
    assert.doesNotMatch(markdown, /(?<!\\)\[click here(?<!\\)\]/);
    assert.doesNotMatch(markdown, /(?<!\\)!(?<!\\)\[/);
    assert.doesNotMatch(markdown, /(?<!\\)<img/);
    // The table row still has exactly four cells.
    const row = markdown.split("\n").find((line) => line.startsWith("| **HIGH**"))!;
    assert.equal(row.match(/(?<!\\)\|/g)?.length, 5);
  });
});

describe("formatMarkdown size limits", () => {
  const MIB = 1024 * 1024;

  it("cuts very long values, without splitting a character", () => {
    const long = `${"x".repeat(499)}😀${"y".repeat(1_000)}`;
    const markdown = formatMarkdown(report({ findings: [{ ...scriptFinding, message: long }] }));
    // 499 x's plus the emoji make 500 characters; the y's after them are cut.
    assert.match(markdown, /x{499}😀…<br>/);
    assert.doesNotMatch(markdown, /😀y/);
  });

  it("stays within GitHub's 1 MiB limit for any number of findings, and says what was left out", () => {
    const findings = Array.from({ length: 20_000 }, (_, i) => ({
      ...scriptFinding,
      package: { name: `package-${i}`, version: "1.0.0" },
      message: "m".repeat(400),
    }));
    const ignored = findings.slice(0, 5_000).map((f) => ({ ...f, ignoreReason: "r".repeat(400) }));
    const warnings = Array.from({ length: 5_000 }, () => "w".repeat(400));

    const markdown = formatMarkdown(report({ findings, ignored, warnings }));
    assert.ok(new TextEncoder().encode(markdown).length < MIB, "report is under 1 MiB");
    assert.match(markdown, /\| … \| \| \| \d+ more findings not shown here, to keep this report within size limits/);
    assert.match(markdown, /^- …and \d+ more accepted findings, listed in the command's output\.$/m);
    assert.match(markdown, /^- …and \d+ more notes, listed in the command's output\.$/m);
    // The sections after the table are still there and the HTML is balanced.
    assert.match(markdown, /<\/details>/);
  });

  it("leaves small reports untouched", () => {
    assert.doesNotMatch(formatMarkdown(report()), /more findings not shown/);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
