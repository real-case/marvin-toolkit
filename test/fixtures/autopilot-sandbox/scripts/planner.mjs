// The fake planner's work: write the spec task-start would have written, sealed. It runs in the
// run worktree (its cwd). The contract hash is computed here, as `contractHash` computes it
// (`storage/spec.ts`), so that no formatter run over this fixture can unseal a committed copy.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const block = [
  "files:",
  "  - { id: F1, path: src/math.mjs, action: edit, satisfies: [AC1] }",
  "  - { id: F2, path: test/clamp.test.mjs, action: new, satisfies: [AC1] }",
  "criteria:",
  "  - id: AC1",
  "    statement: clamp(x, lo, hi) returns x bounded to the closed range [lo, hi]",
  "    implemented_by: [F1, F2]",
  "    oracle: { kind: test, ref: test/clamp.test.mjs }",
].join("\n");
const sha = createHash("sha256").update(block.trim()).digest("hex").slice(0, 16);
const spec = [
  "---",
  "slug: clamp",
  "type: feature",
  "status: ready",
  "risk: medium",
  `contract_sha: ${sha}`,
  "---",
  "# clamp",
  "",
  "## Goal",
  "",
  "Add `clamp(x, lo, hi)` to `src/math.mjs`.",
  "",
  "```yaml spec-contract",
  block,
  "```",
  "",
].join("\n");
mkdirSync(".marvin/task", { recursive: true });
writeFileSync(".marvin/task/001-clamp.md", spec);
