#!/usr/bin/env node
// Guard (ADR-0024): the committed MCP Apps widget documents under
// plugins/marvin/widgets/ are the exact output of a fresh widgets build AND are
// self-contained (no external http(s) references — the host renders them under a
// strict CSP that blocks external hosts). Mirrors verify-dist.mjs for the server
// bundle. Nonzero exit on drift or an external reference.

import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const widgetsDir = join(repoRoot, "plugins", "marvin", "widgets");

const htmlFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".html")) : [];

const committed = htmlFiles(widgetsDir);
if (committed.length === 0) {
  console.error("verify-widgets: no committed widget HTML found under plugins/marvin/widgets/");
  process.exit(1);
}

// Snapshot committed hashes before rebuilding over them.
const before = new Map(committed.map((f) => [f, hashFile(join(widgetsDir, f))]));

// Build @marvin-toolkit/mcp-shared first (the widgets type-check against its
// dist/contracts), then rebuild the widgets — npm workspace order is not
// topological, so the dependency is built explicitly first.
try {
  execSync("npm run build --silent -w @marvin-toolkit/mcp-shared", {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execSync("npm run build --silent -w @marvin-toolkit/widgets", {
    cwd: repoRoot,
    stdio: "inherit",
  });
} catch (err) {
  console.error(`verify-widgets: build failed: ${err.message}`);
  process.exit(1);
}

let failures = 0;
const rebuilt = htmlFiles(widgetsDir);
const rebuiltSet = new Set(rebuilt);

// 1. Drift — every committed file matches its fresh rebuild; none appeared/vanished.
for (const f of committed) {
  if (!rebuiltSet.has(f)) {
    console.error(`FAIL: committed ${f} was not produced by a fresh build`);
    failures += 1;
    continue;
  }
  const after = hashFile(join(widgetsDir, f));
  if (before.get(f) !== after) {
    console.error(
      `FAIL: committed plugins/marvin/widgets/${f} differs from a fresh build.\n` +
        `  fix: npm run build -w @marvin-toolkit/widgets && git add plugins/marvin/widgets/`,
    );
    failures += 1;
  } else {
    console.log(`OK   drift: ${f} in sync`);
  }
}
for (const f of rebuilt) {
  if (!committed.includes(f)) {
    console.error(`FAIL: fresh build produced ${f} which is not committed — add it`);
    failures += 1;
  }
}

// 2. Self-contained — no external http(s) script/style/font/img references. The
// widget is inlined into one document; any external resource load would break
// under the host CSP. (Plain URL string literals inside the bundled JS — e.g.
// React's error-decoder link — are not resource loads and are intentionally not
// matched; only markup/CSS resource references are.)
const EXTERNAL = [
  { label: "script src", re: /<script\b[^>]*\bsrc\s*=\s*["']https?:/i },
  { label: "link href", re: /<link\b[^>]*\bhref\s*=\s*["']https?:/i },
  { label: "img src", re: /<img\b[^>]*\bsrc\s*=\s*["']https?:/i },
  { label: "css @import", re: /@import\b[^;]*https?:/i },
  { label: "css url()", re: /url\(\s*["']?https?:/i },
];
for (const f of rebuilt) {
  const html = readFileSync(join(widgetsDir, f), "utf8");
  const hits = EXTERNAL.filter(({ re }) => re.test(html));
  if (hits.length > 0) {
    for (const { label } of hits) {
      console.error(
        `FAIL: ${f} references an external ${label} — the host CSP blocks external hosts; the widget must be self-contained`,
      );
    }
    failures += 1;
  } else {
    console.log(`OK   self-contained: ${f}`);
  }
}

if (failures > 0) {
  console.error(`\nverify-widgets: ${failures} problem(s)`);
  process.exit(1);
}
console.log(`\nverify-widgets: all ${rebuilt.length} widget(s) in sync and self-contained`);

function hashFile(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
