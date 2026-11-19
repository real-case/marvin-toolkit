import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A throwaway git repository with a few source files and some history, for the hunt tests. */
export function huntRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "marvin-hunt-"));
  const sh = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.invalid",
      },
    });
  sh("init", "-q", "-b", "main");
  const seed = {
    "src/auth/session.ts":
      "export function login(token: string) {\n  return token.length > 0;\n}\n",
    "src/util/format.ts": "export const pad = (n: number) => String(n).padStart(2, '0');\n",
    "src/util/format.test.ts": "import { pad } from './format';\n",
    "README.md": "# fixture\n",
    ...files,
  };
  for (const [p, body] of Object.entries(seed)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  sh("add", "-A");
  sh("commit", "-q", "-m", "init");
  writeFileSync(
    join(root, "src/auth/session.ts"),
    "export function login(token: string) {\n  return token.trim().length > 0;\n}\n",
  );
  sh("commit", "-q", "-am", "fix: trim the token");
  return { root, sh };
}

/** The ServerEnv slice the hunt tool reads. */
export function huntEnv(root) {
  return {
    projectDir: root,
    configPath: join(root, ".marvin", "config.json"),
    huntDir: join(root, ".marvin", "hunt"),
  };
}

export const textOf = (r) => r.content.map((c) => c.text).join("\n");

/** A minimal valid claim; override any field. */
export function claim(over = {}) {
  return {
    check: "code",
    class: "bug",
    category: "CODE-D04",
    title: "login accepts a whitespace-only token",
    summary: "A token of spaces passes the length check before trim was added.",
    location: { files: [{ path: "src/auth/session.ts", line: 2 }] },
    expected: "a whitespace-only token is refused",
    actual: "it is accepted",
    reproduction: {
      steps: ["call login('   ')"],
      proposed_test_path: "src/auth/session.repro.test.ts",
    },
    severity: "high",
    confidence: "high",
    producer: "marvin-hunt-hunter",
    ...over,
  };
}

/** A server stub whose client cannot elicit, so a human ruling is recorded unattested. */
export const NO_ELICIT = { server: { getClientCapabilities: () => ({}) } };

/** A server stub whose client answers every elicitation with `answer` (accept + content). */
export function elicitingServer(answer) {
  return {
    server: {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: async () =>
        answer === null ? { action: "decline" } : { action: "accept", content: answer },
    },
  };
}

/** Write a file into the fixture repository (a reproducing test, say). */
export function writeRepoFile(root, rel, body = "// repro\n") {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}
