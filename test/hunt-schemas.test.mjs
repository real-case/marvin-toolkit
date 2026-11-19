import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The committed hunt JSON Schemas (ADR-0054) are the zod contracts in another form; an agent is
// pointed at them, the tool validates with the contracts. They must not drift apart.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the committed hunt schemas match the contracts", () => {
  const r = spawnSync(
    process.execPath,
    [join(root, "scripts", "gen-hunt-schemas.mjs"), "--check"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
