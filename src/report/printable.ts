/**
 * Makes untrusted text safe to display in a terminal, a CI log or a web page.
 *
 * Package names, versions and dependency paths come from the lockfile, which
 * a pull request can change. Script commands and publisher names come from the
 * registry, which anyone can publish to. Ignore reasons and warnings can
 * quote any of these. Shown as they are, some characters could change what a
 * reader sees:
 *
 *   - control characters, such as terminal escape sequences, carriage returns
 *     and backspaces, can move the cursor, recolour or overwrite lines, so a
 *     crafted value could hide a finding or fake a clean result;
 *   - invisible format characters, including the right-to-left overrides
 *     used in "Trojan Source" attacks, make text display in a different order
 *     from its real content, or hide characters entirely;
 *   - line and paragraph separators start a new line in some viewers.
 *
 * printable() shows each of these as a visible escape such as `\u{1B}`, so
 * the text can't act on the display and its oddness stays visible. Every
 * output format applies it to every value that came from outside deplens.
 */

/** Unicode control (Cc), format (Cf), and line and paragraph separator (Zl, Zp) characters. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function printable(text: string): string {
  return text.replace(UNSAFE, (char) => `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`);
}
