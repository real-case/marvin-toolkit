#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  readFileSync(0);
} catch {
  /* payload unused */
}
const {
  MARVIN_PIPELINE_RUN: run,
  MARVIN_PIPELINE_CHILD: child,
  MARVIN_PIPELINE_ORCH: orch,
} = process.env;
if (!run || !child) process.exit(0);
const interval = Number(process.env.MARVIN_PIPELINE_HEARTBEAT_S ?? 300) * 1000;
const file = join(run, `${child}.heartbeat`);
const now = Date.now();
if (!existsSync(file)) {
  writeFileSync(file, String(now));
  process.exit(0);
}
const last = Number(readFileSync(file, "utf8")) || now;
if (now - last < interval) process.exit(0);
writeFileSync(file, String(now));
const minutes = Math.round((now - last) / 60_000);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `PIPELINE HEARTBEAT: ${minutes} min since your last progress report. Before your next step, send one with SendMessage to "${orch}": "[${child}] done: … | next: … | blockers: …" — at most 3 short lines, English. Then continue.`,
    },
  }),
);
