#!/usr/bin/env node
// Prints the milliseconds of the duration given as the only argument; exit 2 on a bad one.
import { parseDuration } from "../src/duration.mjs";

try {
  process.stdout.write(`${parseDuration(process.argv[2] ?? "")}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
