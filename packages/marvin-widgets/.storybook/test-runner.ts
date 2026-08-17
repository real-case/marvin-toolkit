import { existsSync } from "node:fs";
import { join } from "node:path";
import { getStoryContext, waitForPageReady } from "@storybook/test-runner";
import type { TestRunnerConfig } from "@storybook/test-runner";
import { toMatchImageSnapshot } from "jest-image-snapshot";
import type { MatchImageSnapshotOptions } from "jest-image-snapshot";

/**
 * Visual regression rides the existing `test-storybook` pass: after each
 * story's `play` succeeds, `postVisit` screenshots the page and compares it
 * against a committed baseline via jest-image-snapshot. One harness covers
 * every story — a widget gains visual coverage by existing, and a dark variant
 * by being an explicit `<Base>Dark` story (see preview.ts).
 *
 * Stories opt out with `parameters: { visual: false }` — used by the mock-host
 * handshake stories, whose render is either redundant with the static fixture
 * story or nondeterministic mid-handshake.
 */

// The test-runner executes this config under jest, where `expect` is jest's
// global — but this package types globals via `vitest/globals` (tsconfig), so
// TypeScript sees vitest's `expect`. Teach that typed surface the matcher
// `setup()` installs at runtime; the runtime objects never mix.
declare module "vitest" {
  interface Assertion<T> {
    toMatchImageSnapshot(options?: MatchImageSnapshotOptions): T;
  }
}

// Baselines are platform-scoped because font rasterisation differs between
// darwin and linux — a darwin-rendered PNG never byte-matches a linux one.
// Only the darwin baselines are committed; a platform with no committed
// baseline dir (CI's ubuntu today) skips the comparison instead of silently
// writing throwaway baselines that would "pass" once and rot. To bootstrap a
// new platform's baselines, run with STORYBOOK_VISUAL=1.
const SNAPSHOTS_ROOT = join(__dirname, "..", "__image_snapshots__");

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async preVisit(page) {
    // Pin the viewport: fullPage screenshots still depend on layout width, and
    // the playwright default (1280×720) is not guaranteed across environments.
    await page.setViewportSize({ width: 1000, height: 800 });
  },
  async postVisit(page, context) {
    const ctx = await getStoryContext(page, context);
    if (ctx.parameters?.visual === false) return;
    await waitForPageReady(page);

    const snapshotsDir = join(SNAPSHOTS_ROOT, process.platform);
    if (!existsSync(snapshotsDir) && process.env.STORYBOOK_VISUAL !== "1") return;

    const image = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: snapshotsDir,
      customSnapshotIdentifier: context.id,
      customDiffDir: join(SNAPSHOTS_ROOT, "__diff_output__"),
      // Same platform + pinned browser renders byte-identically (measured:
      // repeated full runs diff at 0 pixels), so the budget only has to absorb
      // sub-glyph antialiasing jitter. 100 px stays below a single changed
      // digit (~112 px) — a one-character regression already fails the gate.
      // A percent budget would not: 0.5% of a full-page shot licensed ~10k px,
      // enough to hide a recoloured badge or a dropped border.
      failureThreshold: 100,
      failureThresholdType: "pixel",
    });
  },
};

export default config;
