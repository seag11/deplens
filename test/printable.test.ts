import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { printable } from "../src/report/printable.ts";
import { formatText } from "../src/report/text.ts";
import type { Finding } from "../src/types.ts";

describe("printable", () => {
  const cases: Array<[input: string, expected: string, what: string]> = [
    ["\u001b[2Kfake clean result", "\\u{1B}[2Kfake clean result", "a terminal escape sequence"],
    ["HIGH\rlow", "HIGH\\u{D}low", "a carriage return that would overwrite the line"],
    ["a\bb", "a\\u{8}b", "a backspace"],
    ["line\nbreak", "line\\u{A}break", "a newline"],
    ["tab\there", "tab\\u{9}here", "a tab"],
    ["nul\u0000del\u007f", "nul\\u{0}del\\u{7F}", "NUL and DEL"],
    ["c1\u009b", "c1\\u{9B}", "a C1 control (single-byte escape introducer)"],
    ["evil‮txt.exe", "evil\\u{202E}txt.exe", "a right-to-left override"],
    ["⁦isolate⁩", "\\u{2066}isolate\\u{2069}", "bidirectional isolates"],
    ["zero​width", "zero\\u{200B}width", "a zero-width space"],
    ["bom﻿", "bom\\u{FEFF}", "a byte order mark"],
    ["line para ", "line\\u{2028}para\\u{2029}", "line and paragraph separators"],
  ];

  for (const [input, expected, what] of cases) {
    it(`makes ${what} visible`, () => assert.equal(printable(input), expected));
  }

  it("leaves ordinary text alone, including letters from any script and emoji", () => {
    for (const text of ["some-lib@1.4.2", 'Runs postinstall "node install.js || true"', "café", "日本語", "😀 ok"]) {
      assert.equal(printable(text), text);
    }
  });
});

describe("formatText with hostile values", () => {
  const HOSTILE = "\u001b[2K\r‮x​\nHIGH fake";
  const finding: Finding = {
    ruleId: "DL001",
    ruleName: "install-script",
    severity: "low",
    package: { name: HOSTILE, version: HOSTILE },
    message: HOSTILE,
    evidence: {},
    via: [HOSTILE, HOSTILE],
  };

  it("never prints a control or invisible character from outside deplens", () => {
    const text = formatText({
      packageCount: 1,
      findings: [finding],
      ignored: [{ ...finding, ignoreReason: HOSTILE }],
      warnings: [HOSTILE],
    });
    for (const line of text.split("\n")) {
      assert.doesNotMatch(line, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u, JSON.stringify(line));
    }
  });
});
