/**
 * The play-function oracle. Stories run their `play` under
 * `@storybook/test-runner` without the `@storybook/test` package, so instead of
 * `expect(...).toBeVisible()`-style retries they poll the DOM directly — the
 * same 50ms-poll pattern the first mock-host stories used inline, extracted so
 * every story shares one timeout and one failure shape.
 *
 * Rejects with `timed out waiting for ${what}` so a red test names the missing
 * condition, not just "timeout".
 */
export async function waitForCondition(
  check: () => boolean,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
