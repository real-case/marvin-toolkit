#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { MARVIN_PIPELINE_RUN: run, MARVIN_PIPELINE_CHILD: child } = process.env;
let payload = null;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
if (!run || !child || payload?.tool_name !== "SendMessage") process.exit(0);
const { to = "", message = "" } = payload.tool_input ?? {};
appendFileSync(
  join(run, "events.jsonl"),
  `${JSON.stringify({ ts: new Date().toISOString(), kind: "report", actor: child, text: message, data: { to } })}\n`,
);
writeFileSync(join(run, `${child}.heartbeat`), String(Date.now()));
