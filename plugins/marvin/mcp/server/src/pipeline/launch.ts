import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildCommand } from "./command.js";

export interface LaunchResult {
  pid: number;
  logPath: string;
  errPath: string;
  exitPath: string;
}

const WRAPPER = [
  'out="$1"; err="$2"; exitf="$3"; shift 3',
  '"$@" < /dev/null > "$out" 2> "$err" &',
  "child=$!",
  "trap 'kill -TERM \"$child\" 2>/dev/null' TERM INT",
  'wait "$child"; code=$?',
  'kill -0 "$child" 2>/dev/null && { wait "$child"; code=$?; }',
  'echo "$code" > "$exitf"',
].join("\n");

export function launchDetached(cmd: ChildCommand, runDir: string, name: string): LaunchResult {
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, `${name}.log.jsonl`);
  const errPath = join(runDir, `${name}.err`);
  const exitPath = join(runDir, `${name}.exit`);
  const child = spawn("/bin/sh", ["-c", WRAPPER, "sh", logPath, errPath, exitPath, ...cmd.argv], {
    cwd: cmd.cwd,
    env: { ...process.env, ...cmd.env },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid === undefined) throw new Error(`failed to launch ${name}`);
  return { pid: child.pid, logPath, errPath, exitPath };
}
