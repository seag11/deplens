#!/usr/bin/env node
/**
 * The `deplens` executable.
 *
 * Kept separate from cli.ts so that importing the CLI (in tests, or from
 * another tool) never runs it as a side effect.
 */

import { main } from "./cli.ts";

process.exitCode = main(process.argv.slice(2));
