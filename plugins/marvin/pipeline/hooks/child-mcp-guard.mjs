#!/usr/bin/env node
import { deny, main, readPayload } from "../../hooks/lib/hook-io.mjs";

main("child-mcp-guard", () => {
  const action = readPayload()?.tool_input?.action;
  return ["start", "create", "move", "review", "done"].includes(action)
    ? deny("child-mcp-guard", [
        `Pipeline child: task action:${action} changes the board or the branch; the pipeline owns both.`,
      ])
    : 0;
});
