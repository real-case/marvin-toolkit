import type { TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TrackerListPayload (ADR-0024 #6) shared by the tests and the
 * story. It carries two tracked tasks so both link states render:
 *  - OSI-101 has a `tracker_url` → the external link-out button (AC2, app.openLink);
 *  - OSI-140 has a `tracker_url` of `null` (the `tracker_url_template` is
 *    unconfigured) → the id-as-text + configure hint, no dead link (AC6).
 * Only tracker-bearing tasks appear — the `tracker` tool filters the board before
 * building this payload. Timestamps are fixed literals (no `Date.now()`) to keep the
 * story and snapshots deterministic.
 */
export const trackerListFixture: TrackerListPayload = {
  tasks: [
    {
      id: "001",
      type: "bug",
      status: { key: "wip", role: "wip" },
      title: "Fix login timeout on slow networks",
      branch: "fix/001-OSI-101--login-timeout",
      tracker_id: "OSI-101",
      tracker_url: "https://tracker.example/browse/OSI-101",
      pr: { url: "https://github.com/acme/app/pull/12", number: 12 },
      created: "2026-07-01T10:00:00.000Z",
      updated: "2026-07-03T14:15:00.000Z",
    },
    {
      id: "002",
      type: "feature",
      status: { key: "todo", role: "todo" },
      title: "Add SSO onboarding flow",
      branch: "feat/002-OSI-140--sso-onboarding",
      tracker_id: "OSI-140",
      // No derived URL — the project's tracker_url_template is unset (AC6 branch).
      tracker_url: null,
      pr: null,
      created: "2026-07-02T09:00:00.000Z",
      updated: "2026-07-02T09:00:00.000Z",
    },
  ],
};

/**
 * Every card carries a `tracker_id` but no derived `tracker_url` — the project
 * has no `tracker_url_template` configured at all, so the whole list renders the
 * id-as-text + configure hint branch (AC6) and not a single link-out button.
 */
export const noUrlTrackerFixture: TrackerListPayload = {
  tasks: [
    {
      id: "003",
      type: "chore",
      status: { key: "review", role: "review" },
      title: "Rotate the staging deploy keys",
      branch: "chore/003-OPS-52--rotate-deploy-keys",
      tracker_id: "OPS-52",
      tracker_url: null,
      pr: null,
      created: "2026-07-04T08:30:00.000Z",
      updated: "2026-07-05T16:45:00.000Z",
    },
    {
      id: "004",
      type: "spike",
      status: { key: "todo", role: "todo" },
      title: "Evaluate OpenTelemetry for the API gateway",
      branch: "spike/004-OPS-61--otel-gateway",
      tracker_id: "OPS-61",
      tracker_url: null,
      pr: null,
      created: "2026-07-05T11:20:00.000Z",
      updated: "2026-07-05T11:20:00.000Z",
    },
  ],
};

/** An empty payload — no task carries a tracker id (AC4 empty state). */
export const emptyTrackerFixture: TrackerListPayload = { tasks: [] };
