// Codex CLI target adapter.
//
// Mappings (see docs/codex-target.md for the full contract):
//   skill        SKILL.md → .codex/prompts/<name>.md  (frontmatter stripped)
//                non-SKILL files in skill folders → SKIPPED
//   command      UNSUPPORTED — Marvin commands are thin pointers to same-named
//                skills; the skill is shipped instead. Avoids a path collision
//                at .codex/prompts/<name>.md and keeps the real workflow intact.
//   agent        UNSUPPORTED — Codex CLI has no first-class subagent concept
//   .mcp.json    NOT auto-merged — postWrite prints a TOML snippet for the
//                user to paste into ~/.codex/config.toml
//   manifest     .codex/.marvin-eject.json
//   pack         marvin-taskmaster-pack is REJECTED at the unsupportedPack gate
//                (depends on Claude subagents). marvin-security-pack is allowed
//                but practically unvalidated; users should expect surprises.

import { injectHeader } from "../lib/eject-core.mjs";

const codexAdapter = {
  name: "codex",

  unsupportedPack(packName) {
    if (packName === "marvin-taskmaster-pack") {
      return {
        reason: "marvin-taskmaster-pack relies on Claude subagents (writer, critics, executor) which Codex CLI does not provide as a first-class concept.",
        suggestion: "See docs/codex-target.md for the supported pack matrix. Use --target=claude for taskmaster.",
      };
    }
    return null;
  },

  unsupported(artifact) {
    if (artifact.kind === "agent") {
      return {
        reason: "Codex CLI has no first-class subagent concept",
        suggestion: "Inline the agent's prompt into a relevant skill manually, or invoke it directly from a Codex prompt file.",
      };
    }
    if (artifact.kind === "command") {
      return {
        reason: "Marvin commands are thin pointers to same-named skills",
        suggestion: "The matching skills/<name> is shipped instead as the Codex slash-prompt. Standalone commands are not yet handled.",
      };
    }
    return null;
  },

  pathFor(artifact, fileRel) {
    // Only skills are supported; unsupported() filters the rest.
    if (artifact.kind === "skill") {
      if (fileRel !== "SKILL.md") return null;
      return `.codex/prompts/${artifact.name}.md`;
    }
    throw new Error(`codexAdapter: unexpected kind "${artifact.kind}" reached pathFor`);
  },

  render(_artifact, sourceContent, opts) {
    if (!opts.isMarkdown) return sourceContent;
    const stripped = stripFrontmatter(sourceContent);
    return injectHeader(stripped, opts.packName, opts.packVersion, opts.today);
  },

  manifestPath() { return ".codex/.marvin-eject.json"; },

  manifestSchema() {
    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["version", "ejected"],
      properties: {
        version: { const: 1 },
        ejected: {
          type: "array",
          items: {
            type: "object",
            required: ["source", "sourceVersion", "ejectedAt", "artifact", "files"],
            properties: {
              source: { type: "string" },
              sourceVersion: { type: "string" },
              ejectedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              artifact: { type: "string" },
              files: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    };
  },

  async postWrite(plan, _projectRoot) {
    const lines = [];
    if (plan.skipped.length > 0) {
      lines.push(`note: ${plan.skipped.length} artifact(s) skipped:`);
      for (const s of plan.skipped) {
        lines.push(`  - ${s.artifact.kind}/${s.artifact.name} — ${s.warning.reason}`);
        if (s.warning.suggestion) lines.push(`      ${s.warning.suggestion}`);
      }
    }
    if (plan.mcpHint?.config?.mcpServers) {
      lines.push("");
      lines.push("note: pack ships MCP servers. Codex doesn't auto-merge them — paste the");
      lines.push("following snippet into ~/.codex/config.toml:");
      lines.push("");
      lines.push(jsonMcpToToml(plan.mcpHint.config.mcpServers));
    }
    if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  },
};

// ─── helpers (kept tiny; under the 200-line file budget) ───────────────────

function stripFrontmatter(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return content;
  const firstLineEnd = content.indexOf("\n");
  const rest = content.slice(firstLineEnd + 1);
  const m = rest.match(/\n---(?:\r?\n|$)/);
  if (!m) return content;
  return rest.slice(m.index + m[0].length).replace(/^\n+/, "");
}

// Minimal JSON→TOML for the mcpServers shape: { name: { command, args, env } }.
// Conservatively quotes string values; errors out on unexpected types so we
// don't emit silently-malformed TOML.
function jsonMcpToToml(mcpServers) {
  const out = [];
  for (const [name, cfg] of Object.entries(mcpServers)) {
    out.push(`[mcp_servers.${name}]`);
    for (const [k, v] of Object.entries(cfg)) {
      if (k === "env" && v && typeof v === "object") continue;
      out.push(`${k} = ${tomlValue(v)}`);
    }
    if (cfg.env && typeof cfg.env === "object") {
      out.push("");
      out.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(cfg.env)) out.push(`${k} = ${tomlValue(v)}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

function tomlValue(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  throw new Error(`jsonMcpToToml: cannot serialize value of type ${typeof v}`);
}

export default codexAdapter;
