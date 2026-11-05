/**
 * The rule registry: every rule deplens runs, in ID order.
 *
 * To add a rule, write it in its own file in this folder and list it here.
 */

import type { Rule } from "../types.ts";
import { installScript } from "./install-script.ts";
import { unusualSource } from "./unusual-source.ts";

export const RULES: readonly Rule[] = [installScript, unusualSource];

/** Looks up a rule by its ID, such as `DL001`. */
export function findRule(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}
