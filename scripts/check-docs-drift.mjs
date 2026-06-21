#!/usr/bin/env node
// Guard against documentation drift. Fails when the human-facing docs fall out of
// sync with the source of truth:
//   1. ADR coverage — every docs/adr/NNNN-*.md is linked from the README and the
//      docs index, so the architecture-decisions list cannot silently go stale.
//   2. Working-directory paths — the "live" docs use the current `.marvin/...`
//      layout (ADR-0007), never the pre-0009 `marvin/tasks/` / `marvin/config.json`.
//      History (CHANGELOG.md, docs/adr/0009-*) is intentionally exempt.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const failures = [];

// 1. Every ADR must be referenced in each index.
const adrNumbers = readdirSync(join(repoRoot, "docs", "adr"))
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .map((f) => f.slice(0, 4))
  .sort();

const indexes = ["README.md", "docs/README.md"];
for (const index of indexes) {
  const text = read(index);
  for (const num of adrNumbers) {
    if (!new RegExp(`adr/${num}-`).test(text)) {
      failures.push(`${index}: ADR ${num} exists under docs/adr/ but is not linked here`);
    }
  }
}

// 2. No pre-ADR-0007 working-dir paths in the live docs.
const liveDocs = [
  "README.md",
  "docs/README.md",
  "docs/architecture.md",
  "plugins/marvin/README.md",
];
const stalePath = /(?<!\.)marvin\/(tasks|config\.json)/;
for (const doc of liveDocs) {
  read(doc)
    .split("\n")
    .forEach((line, i) => {
      const match = line.match(stalePath);
      if (match) {
        failures.push(
          `${doc}:${i + 1}: stale path 'marvin/${match[1]}' — use '.marvin/...' (ADR-0007)`,
        );
      }
    });
}

if (failures.length > 0) {
  console.error("check-docs-drift: FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `check-docs-drift: OK (${adrNumbers.length} ADRs cross-checked across ${indexes.length} indexes)`,
);
