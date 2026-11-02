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

/**
 * Variables that tell a `claude` process which session it belongs to. A Claude Code cloud
 * session sets them, and a nested `claude -p` that inherits them reports the parent's session
 * (probe of 2026-11-02). They are dropped so a child is its own session; the transport and
 * messaging variables beside them (`ANTHROPIC_BASE_URL`, `CLAUDE_SESSION_INGRESS_TOKEN_FILE`,
 * `CLAUDE_CODE_MESSAGING_*`) are kept, because the child reaches the model and SendMessage
 * through them.
 */
export const SESSION_IDENTITY_VARIABLES = [
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_REMOTE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
] as const;

/** A child's environment: the engine's own without its session identity, then the role's. */
export function childEnvironment(
  base: NodeJS.ProcessEnv,
  role: Record<string, string>,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of SESSION_IDENTITY_VARIABLES) delete env[name];
  return { ...env, ...role };
}

export function launchDetached(cmd: ChildCommand, runDir: string, name: string): LaunchResult {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const logPath = join(runDir, `${name}.log.jsonl`);
  const errPath = join(runDir, `${name}.err`);
  const exitPath = join(runDir, `${name}.exit`);
  const child = spawn("/bin/sh", ["-c", WRAPPER, "sh", logPath, errPath, exitPath, ...cmd.argv], {
    cwd: cmd.cwd,
    // The engine's environment is passed on whole, credentials included: the executor pushes
    // and opens its pull request through `gh api`, which authenticate through GH_TOKEN / GITHUB_TOKEN where the user
    // set them, and every role is a `claude -p` that may reach the model through Bedrock or
    // Vertex credentials (AWS_*, GOOGLE_*, CLOUD_ML_*). Stripping them would stop the run rather
    // than contain it; the child's guards, not its environment, bound what it does. Only the
    // parent's session identity is removed (`childEnvironment`).
    env: childEnvironment(process.env, cmd.env),
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
