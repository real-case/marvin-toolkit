#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { orchestratorOf } from "./lib/orchestrator.mjs";

try {
  readFileSync(0);
} catch {
  /* payload unused */
}
const {
  MARVIN_PIPELINE_RUN: run,
  MARVIN_PIPELINE_CHILD: child,
  MARVIN_PIPELINE_ORCH: launchedWith,
} = process.env;
if (!run || !child) process.exit(0);
const orch = orchestratorOf(run, launchedWith);
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
// Recorded so a run shows when the reminder fired: a child's stream-json log does not carry hook
// context. No notify flag, so `await` never shows it to the orchestrator; a failed append must not
// stop the reminder itself.
try {
  appendFileSync(
    join(run, "events.jsonl"),
    `${JSON.stringify({ ts: new Date(now).toISOString(), kind: "note", actor: child, text: `heartbeat: ${minutes} min since the last report`, data: { heartbeat: true, minutes } })}\n`,
  );
} catch {
  /* the reminder still goes out */
}
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `PIPELINE HEARTBEAT: ${minutes} min since your last progress report. Before your next step, send one with SendMessage to "${orch}": "[${child}] done: … | next: … | blockers: …" — at most 3 short lines, English. Then continue.`,
    },
  }),
);
