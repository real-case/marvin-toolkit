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
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const logPath = join(runDir, `${name}.log.jsonl`);
  const errPath = join(runDir, `${name}.err`);
  const exitPath = join(runDir, `${name}.exit`);
  const child = spawn("/bin/sh", ["-c", WRAPPER, "sh", logPath, errPath, exitPath, ...cmd.argv], {
    cwd: cmd.cwd,
    // The engine's environment is passed on whole, credentials included: the executor pushes
    // and runs `gh pr create`, which authenticate through GH_TOKEN / GITHUB_TOKEN where the user
    // set them, and every role is a `claude -p` that may reach the model through Bedrock or
    // Vertex credentials (AWS_*, GOOGLE_*, CLOUD_ML_*). Stripping them would stop the run rather
    // than contain it; the child's guards, not its environment, bound what it does.
    env: { ...process.env, ...cmd.env },
    detached: true,
    stdio: "ignore",
  });

  let spawnError: Error | null = null;
  child.on("error", (err: Error) => {
    spawnError = err;
  });

  child.unref();
  if (child.pid === undefined) {
    const message = spawnError
      ? `failed to launch ${name}: ${(spawnError as Error).message}`
      : `failed to launch ${name}`;
    throw new Error(message);
  }
  return { pid: child.pid, logPath, errPath, exitPath };
}
