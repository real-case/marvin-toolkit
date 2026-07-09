import type { TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TaskListPayload (ADR-0024) shared by the tests and the story —
 * one card in each lifecycle role, a tracker link, a linked PR, and a spec slug,
 * so a single fixture exercises every branch the widget renders. Timestamps are
 * fixed literals (no `Date.now()`) to keep the story and snapshots deterministic.
 */
export const taskListFixture: TaskListPayload = {
  tasks: [
    {
      id: "001",
      type: "bug",
      status: { key: "todo", role: "todo" },
      title: "Fix login timeout on slow networks",
      branch: "fix/001-OSI-101--login-timeout",
      tracker_id: "OSI-101",
      tracker_url: "https://tracker.example/browse/OSI-101",
      pr: null,
      created: "2026-07-01T10:00:00.000Z",
      updated: "2026-07-01T10:00:00.000Z",
    },
    {
      id: "002",
      type: "feature",
      status: { key: "wip", role: "wip" },
      title: "Add dark-mode toggle to settings",
      branch: "feat/002-dark-mode-toggle",
      tracker_url: null,
      pr: { url: "https://github.com/acme/app/pull/12", number: 12 },
      created: "2026-07-02T09:30:00.000Z",
      updated: "2026-07-03T14:15:00.000Z",
    },
    {
      id: "003",
      type: "chore",
      status: { key: "review", role: "review" },
      title: "Bump build toolchain dependencies",
      branch: "chore/003-bump-deps",
      tracker_url: null,
      pr: { url: "https://github.com/acme/app/pull/15", number: 15 },
      created: "2026-07-03T08:00:00.000Z",
      updated: "2026-07-04T11:45:00.000Z",
    },
    {
      id: "004",
      type: "spike",
      status: { key: "done", role: "done" },
      title: "Evaluate Preact for inline widget bundles",
      branch: "spike/004-preact-eval",
      tracker_url: null,
      pr: null,
      spec_slug: "preact-eval",
      created: "2026-06-28T12:00:00.000Z",
      updated: "2026-07-01T16:20:00.000Z",
    },
    {
      id: "005",
      type: "bug",
      status: { key: "blocked", role: "blocked" },
      title: "Flaky end-to-end suite under load",
      branch: "fix/005-flaky-e2e",
      tracker_url: null,
      pr: null,
      created: "2026-06-30T07:10:00.000Z",
      updated: "2026-07-02T18:05:00.000Z",
    },
  ],
  counts: { todo: 1, wip: 1, review: 1, done: 1, blocked: 1 },
  role_counts: { todo: 1, wip: 1, review: 1, done: 1, blocked: 1 },
};

/**
 * An empty board — the shape the `task` tool emits right after `.marvin/kanban/`
 * is initialised: every configured status key present at 0 (ADR-0026 says the
 * open record always carries the full vocabulary) but no role roll-ups, because
 * there are no cards to roll up.
 */
export const emptyTaskListFixture: TaskListPayload = {
  tasks: [],
  counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
  role_counts: {},
};

/**
 * Exactly one card, fully featured (tracker + PR + spec slug) — the singular
 * header ("1 task") and a rich detail pane without any list to compare against.
 */
export const singleTaskFixture: TaskListPayload = {
  tasks: [
    {
      id: "007",
      type: "feature",
      status: { key: "wip", role: "wip" },
      title: "Ship the kanban board ui:// widget",
      branch: "feat/007-OSI-142--kanban-board-widget",
      tracker_id: "OSI-142",
      tracker_url: "https://tracker.example/browse/OSI-142",
      pr: { url: "https://github.com/acme/app/pull/83", number: 83, state: "open" },
      spec_slug: "kanban-board-widget",
      created: "2026-07-05T09:15:00.000Z",
      updated: "2026-07-06T17:40:00.000Z",
    },
  ],
  counts: { todo: 0, wip: 1, review: 0, done: 0, blocked: 0 },
  role_counts: { wip: 1 },
};

/**
 * The minimal legal card — no tracker id, `tracker_url`/`pr` null, no spec slug —
 * so the detail pane must render neither link buttons nor a Spec row.
 */
export const minimalCardFixture: TaskListPayload = {
  tasks: [
    {
      id: "009",
      type: "chore",
      status: { key: "todo", role: "todo" },
      title: "Prune stale feature branches after the 0.2.0 release",
      branch: "chore/009-prune-stale-branches",
      tracker_url: null,
      pr: null,
      created: "2026-07-04T08:00:00.000Z",
      updated: "2026-07-04T08:00:00.000Z",
    },
  ],
  counts: { todo: 1, wip: 0, review: 0, done: 0, blocked: 0 },
  role_counts: { todo: 1 },
};

/** Branch prefixes mirroring the kanban tool's `branch_template` conventions. */
const BRANCH_PREFIX: Record<TaskCard["type"], string> = {
  bug: "fix",
  feature: "feat",
  chore: "chore",
  spike: "spike",
};

const STRESS_TYPES: TaskCard["type"][] = ["bug", "feature", "chore", "spike"];

const STRESS_STATUSES: TaskCard["status"][] = [
  { key: "todo", role: "todo" },
  { key: "wip", role: "wip" },
  { key: "review", role: "review" },
  { key: "done", role: "done" },
  { key: "blocked", role: "blocked" },
];

/**
 * Rotating realistic topics for the stress board. Indices 2 and 6 are the
 * ~140-char truncation probes; 4 and 8 carry unicode/emoji so the row and detail
 * renderers meet non-ASCII; 7 owns the very-long many-segment branch below.
 */
const STRESS_TOPICS: { title: string; slug: string }[] = [
  {
    title: "Fix the verify gate hanging when the test runner prints nothing",
    slug: "verify-gate-hang",
  },
  {
    title: "Add board-count roll-ups to the tracker widget header",
    slug: "tracker-header-counts",
  },
  {
    title:
      "Consolidate the four independently-installable packs into the single marvin plugin so every slash command shares the one /marvin: prefix and server",
    slug: "single-plugin-consolidation",
  },
  {
    title: "Rotate the usage events log before it hits the size cap",
    slug: "usage-log-rotation",
  },
  {
    title: "Поддержка кириллицы в заголовках задач — рендер без обрезки и потери диакритики 🚀",
    slug: "cyrillic-titles",
  },
  {
    title: "Bump the widget toolchain to Vite 6 and re-verify the singlefile output",
    slug: "vite-6-bump",
  },
  {
    title:
      "Teach the spec gate to resolve host-adaptive spec directories (docs/specs, docs/rfcs, rfcs) before falling back to the default .marvin/task location",
    slug: "host-adaptive-spec-dirs",
  },
  {
    title: "Evaluate elicitation-driven config editing for hosts without form support",
    slug: "evaluate-elicitation-driven-config-editing-for-hosts-without-form-support-and-degrade-paths",
  },
  {
    title: "Emoji in card titles must not break row truncation ✂️📋",
    slug: "emoji-truncation",
  },
  {
    title: "De-duplicate the lessons index when near-duplicates are added concurrently",
    slug: "lessons-dedupe",
  },
];

/**
 * Build one deterministic stress card: everything derives from `index` alone
 * (no `Date.now()`/`Math.random()`), so the 25-card board renders byte-identical
 * on every run — a requirement for the visual-regression screenshots. Day
 * arithmetic stays ≤ 28 so every generated datetime is a real calendar date.
 */
function stressCard(index: number): TaskCard {
  const id = String(index + 1).padStart(3, "0");
  const type = STRESS_TYPES[index % STRESS_TYPES.length];
  const topic = STRESS_TOPICS[index % STRESS_TOPICS.length];
  const card: TaskCard = {
    id,
    type,
    status: STRESS_STATUSES[index % STRESS_STATUSES.length],
    title: topic.title,
    branch: `${BRANCH_PREFIX[type]}/${id}-${topic.slug}`,
    tracker_url: null,
    pr: null,
    created: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`,
    updated: `2026-07-${String((index % 7) + 1).padStart(2, "0")}T15:45:00.000Z`,
  };
  if (index % 3 === 0) {
    card.tracker_id = `OSI-${101 + index}`;
    card.tracker_url = `https://tracker.example/browse/OSI-${101 + index}`;
  }
  if (index % 4 === 1) {
    card.pr = { url: `https://github.com/acme/app/pull/${40 + index}`, number: 40 + index };
  }
  if (index % 5 === 3) {
    card.spec_slug = topic.slug;
  }
  return card;
}

const stressTasks: TaskCard[] = Array.from({ length: 25 }, (_, index) => stressCard(index));

// Counts are reduced from the generated cards, never hand-maintained, so the
// header can never drift from the list when the generator changes.
const stressCounts: Record<string, number> = { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 };
const stressRoleCounts: TaskListPayload["role_counts"] = {};
for (const card of stressTasks) {
  stressCounts[card.status.key] += 1;
  stressRoleCounts[card.status.role] = (stressRoleCounts[card.status.role] ?? 0) + 1;
}

/**
 * 25 generated cards — several ~140-char titles, one very-long many-segment
 * branch, unicode/emoji — the list-column truncation and wrap stress payload.
 */
export const stressTaskListFixture: TaskListPayload = {
  tasks: stressTasks,
  counts: stressCounts,
  role_counts: stressRoleCounts,
};
