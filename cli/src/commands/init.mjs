// `marvin init <target> [--only kinds] [--source <path>] [--target claude]
//                       [--dry-run] [--offline]`
//
// Default behaviour: applies. Pass --dry-run for a plan only. Target paths
// and content rendering go through the adapter registry — this file is
// adapter-agnostic and must not embed target-specific path literals.

import { run as runEject } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";
import { getAdapter, listTargets, DEFAULT_TARGET } from "../adapters/index.mjs";

export async function init(opts) {
  const target = opts.target;
  if (!target) return error(`marvin init: <target> is required.\n${usage()}`, 2);

  const adapterName = opts.adapter ?? DEFAULT_TARGET;
  let adapter;
  try { adapter = getAdapter(adapterName); }
  catch {
    return error(`marvin init: --target=${adapterName} not supported. Available: ${listTargets().join(", ")}`, 2);
  }

  const packName = target.split("/")[0];

  // Whole-pack gate: adapter may refuse a pack outright (exit 3).
  if (typeof adapter.unsupportedPack === "function") {
    const warn = adapter.unsupportedPack(packName);
    if (warn) {
      const lines = [`marvin init: pack "${packName}" is not supported on --target=${adapter.name}.`];
      lines.push(`  reason: ${warn.reason}`);
      if (warn.suggestion) lines.push(`  suggestion: ${warn.suggestion}`);
      return error(lines.join("\n"), 3);
    }
  }

  let resolved;
  try {
    resolved = await resolveSource(packName, {
      source: opts.source, cwd: opts.cwd, offline: opts.offline,
    });
  } catch (err) {
    return error(`marvin init: ${err.message}`, 2);
  }

  // Pre-apply dry-run for surfacing errors cleanly when the plan can't be built.
  const planRes = await runEject(buildEjectArgs(opts, resolved.path, false), {
    cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd, adapter,
    stdout: silent(), stderr: silent(),
  });
  if (planRes !== 0) {
    return runEject(buildEjectArgs(opts, resolved.path, false), {
      cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd, adapter,
    });
  }

  if (opts.dryRun) {
    return runEject(buildEjectArgs(opts, resolved.path, false), {
      cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd, adapter,
    });
  }

  return runEject(buildEjectArgs(opts, resolved.path, true), {
    cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd, adapter,
  });
}

function buildEjectArgs(opts, sourcePath, apply) {
  const a = [opts.target];
  if (opts.only && opts.only.length > 0) a.push("--only", opts.only.join(","));
  a.push("--source", sourcePath);
  if (apply) a.push("--apply");
  return a;
}

function error(msg, code) {
  process.stderr.write(`${msg}\n`);
  return code;
}

function silent() {
  return { write: () => {} };
}

function usage() {
  return [
    "usage: marvin init <target> [--only kinds] [--source <path>] [--target <name>]",
    "                             [--dry-run] [--offline]",
    "",
    "  <target>           <pack> | <pack>/skills/<name> | <pack>/commands/<name> | <pack>/agents/<name>",
    "  --only kinds       comma-separated subset: skills,commands,agents (whole-pack only)",
    "  --source <path>    explicit local clone of marvin-toolkit (skips tarball download)",
    `  --target <name>    one of: ${listTargets().join(", ")}`,
    "  --dry-run          print the plan and exit; do not write anything",
    "  --offline          skip the GitHub tarball fallback resolver",
  ].join("\n");
}
