import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for `src/lib/contract-surface.ts` (ADR-0052): which names a free-text
 * `contract.signature` declares, which contract files can hold them, and the judgement the
 * delivery gate reports as `contract_surface`. The e2e half, the gate's answer over a real
 * spec on disk, is in `verify.test.mjs`.
 *
 * The signature shapes below are taken from shipped specs, not invented: column-0
 * declarations among `// path` comments, indented parameter lists, a "REMOVED" section,
 * and route prose whose `body:` / `responses:` labels once read as declared names.
 */

const { surfaceNames, implementationFiles, checkContractSurface } = await importTs(
  "src/lib/contract-surface.ts",
);

test("every declaration shape at column 0 yields its name, in first-seen order", () => {
  const sig = [
    "// plugins/marvin/mcp/server/src/lib/state.ts — four new exports",
    "export const DIGEST_LIMIT = 3;",
    "export function boardDigest(env: ServerEnv, config: Config): TaskCard[];",
    "export async function buildCatalog(): Promise<Catalog>   // pure: writes nothing",
    "export default function CommandCatalog(): JSX.Element",
    "export interface WidgetHostHandle {",
    "  ready: Promise<void>;",
    "  dispose(): void;",
    "}",
    'export type ChatActionResult = "sent" | "copied" | "manual";',
    "worktreeRoot(cwd?: string): string | null",
    "ListDetail<T>(props): JSX.Element",
    "AuditListPayload = reports: AuditReport[]",
    "TARGETS: Record<string, { cwd: string }>",
    "def parse_frontmatter(text: str) -> dict:",
    "pub(crate) async fn load_config(path: &Path) -> Result<Config>",
    "func (s *Server) HandleCall(ctx context.Context) error",
    "boardDigest(env, config)",
  ].join("\n");
  assert.deepEqual(surfaceNames(sig).declared, [
    "DIGEST_LIMIT",
    "boardDigest",
    "buildCatalog",
    "CommandCatalog",
    "WidgetHostHandle",
    "ChatActionResult",
    "worktreeRoot",
    "ListDetail",
    "AuditListPayload",
    "TARGETS",
    "parse_frontmatter",
    "load_config",
    "HandleCall",
  ]);
});

test("indented lines, comment lines, prose labels, routes and strings declare nothing", () => {
  const sig = [
    'POST /api/telegram-results/[lang]   (lang is "ru" or "en")',
    "body: a Telegram Update JSON object (channel_post)",
    "responses: 200 (stored | duplicate | ignored), 400 (bad JSON)",
    "effect: on a channel_post carrying a photo, uploads the largest photo",
    "plus server actions (admin-gated, RLS server client):",
    "  setResultPublished(id: string, published: boolean): Promise<void>",
    "// getUser (else returns the unauthenticated error)",
    "# exported from scripts/dev-watch.mjs",
    '"<path>: does not parse (node --check): <parser message>"',
    "npm run dev:watch                # long-running",
    "if (x) {",
    "/* a block comment naming hiddenName(x) */",
    "task tool _meta = ui.resourceUri -> ui://marvin/task-list.html",
  ].join("\n");
  assert.deepEqual(surfaceNames(sig), { declared: [], removed: [] });
});

test("a removal section and a removal comment take names out of the declared set", () => {
  const sig = [
    "// REMOVED from packages/marvin-mcp-shared/src/contracts/dashboard.ts",
    "export const SecurityInventory = z.object({",
    "  reports: z.number().int().nonnegative(),",
    "});",
    "export const RefactorInventory = z.object({",
    "});",
    "// NEW in packages/marvin-widgets/src/lib/actions.ts",
    "export function runChatAction(host: ChatActionHost | null): Promise<ChatActionResult>;",
    "export const legacyFlag = false; // deleted by this task",
    "",
    "export function afterBlank(): void",
  ].join("\n");
  assert.deepEqual(surfaceNames(sig), {
    declared: ["runChatAction", "afterBlank"],
    removed: ["SecurityInventory", "RefactorInventory", "legacyFlag"],
  });
});

test("a blank line closes a removal section", () => {
  const sig = ["// removed:", "export function gone(): void", "", "export function kept(): void"];
  assert.deepEqual(surfaceNames(sig.join("\n")), { declared: ["kept"], removed: ["gone"] });
});

/** A minimal parsed contract: the shape `SpecContract` gives after zod. */
const contract = (overrides = {}) => ({
  files: [
    { id: "F1", path: "src/thing.ts", action: "edit" },
    { id: "F2", path: "src/old.ts", action: "delete" },
    { id: "F3", path: "CHANGELOG.md", action: "edit" },
    { id: "F4", path: "test/thing.test.mjs", action: "new" },
    { id: "F5", path: "src/thing_test.go", action: "new" },
    { id: "F6", path: "checks/proof.sh", action: "new" },
    { id: "F7", path: "tests/test_thing.py", action: "new" },
  ],
  contract: { kind: "function", signature: "export function makeThing(x: string): Thing" },
  criteria: [
    {
      id: "AC1",
      statement: "it works",
      implemented_by: ["F1"],
      oracle: { kind: "test", ref: "checks/proof.sh::it works" },
    },
  ],
  ...overrides,
});

test("implementation files exclude deletions, documentation, tests and oracle test files", () => {
  assert.deepEqual(implementationFiles(contract()), ["src/thing.ts"]);
});

const reader = (files) => (path) => (path in files ? files[path] : null);

test("a declared name found in an implementation file is matched", () => {
  const check = checkContractSurface(
    contract(),
    reader({ "src/thing.ts": "export function makeThing(x: string) { return x; }\n" }),
  );
  assert.deepEqual(check, { status: "matched", missing: [], reason: null });
});

test("a name found only in a test, a changelog or a deleted file is missing", () => {
  const elsewhere = 'makeThing("a")';
  const check = checkContractSurface(
    contract(),
    reader({
      "src/thing.ts": "export function makeOtherThing(x: string) { return x; }\n",
      "src/old.ts": elsewhere,
      "CHANGELOG.md": elsewhere,
      "test/thing.test.mjs": elsewhere,
      "checks/proof.sh": elsewhere,
    }),
  );
  assert.deepEqual(check, { status: "missing", missing: ["makeThing"], reason: null });
});

test("the search is whole-word: a longer identifier does not match a shorter name", () => {
  const sig = "export function foo(): void\nexport const $bar = 1";
  const check = checkContractSurface(
    contract({ contract: { kind: "function", signature: sig } }),
    reader({ "src/thing.ts": "export function foobar() {}\nconst x$bar = 2;\nconst _foo = 3;\n" }),
  );
  assert.deepEqual(check.missing, ["foo", "$bar"]);
  const found = checkContractSurface(
    contract({ contract: { kind: "function", signature: sig } }),
    reader({ "src/thing.ts": "export function foo() {}\nexport const $bar = 1;\n" }),
  );
  assert.equal(found.status, "matched");
});

test("every case the check cannot judge is unknown, with its reason", () => {
  const read = reader({ "src/thing.ts": "makeThing" });
  for (const [c, reason] of [
    [contract({ contract: undefined }), /no callable surface/],
    [contract({ contract: { kind: "none" } }), /no callable surface/],
    [
      contract({ contract: { kind: "route", signature: "GET /llms.txt -> 200" } }),
      /no declaration/,
    ],
  ]) {
    const check = checkContractSurface(c, read);
    assert.equal(check.status, "unknown");
    assert.deepEqual(check.missing, []);
    assert.match(check.reason, reason);
  }
  const unreadable = checkContractSurface(contract(), reader({}));
  assert.equal(unreadable.status, "unknown");
  assert.match(unreadable.reason, /could be read/);
});
