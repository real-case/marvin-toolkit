// `marvinx init <target> [--only kinds] [--source <path>] [--target claude]
//                       [--dry-run] [--json] [--yes] [--offline]`
//
// Default behaviour: applies. Pass --dry-run for a plan only. The CLI surface
// keeps `<target>` shape compatible with /mn.eject (<pack> | <pack>/<kind>/<name>).

import { run as runEject } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";

const SUPPORTED_TARGETS = new Set(["claude"]);

export async function init(opts) {
  const target = opts.target;
  if (!target) return error(`marvinx init: <target> is required.\n${usage()}`, 2);

  const adapter = opts.adapter ?? "claude";
  if (!SUPPORTED_TARGETS.has(adapter)) {
    return error(`marvinx init: --target=${adapter} not supported in this version. Supported: ${[...SUPPORTED_TARGETS].join(", ")}`, 2);
  }

  const packName = target.split("/")[0];
  let resolved;
  try {
    resolved = await resolveSource(packName, {
      source: opts.source, cwd: opts.cwd, offline: opts.offline,
    });
  } catch (err) {
    return error(`marvinx init: ${err.message}`, 2);
  }

  // Pre-apply dry-run for the human summary.
  const planRes = await runEject(buildEjectArgs(opts, resolved.path, false), {
    cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd, stdout: silent(), stderr: silent(),
  });
  if (planRes !== 0) {
    // Re-run the dry-run with real stderr so the error surfaces.
    return runEject(buildEjectArgs(opts, resolved.path, false), {
      cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd,
    });
  }

  if (opts.dryRun) {
    return runEject(buildEjectArgs(opts, resolved.path, false), {
      cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd,
    });
  }

  return runEject(buildEjectArgs(opts, resolved.path, true), {
    cwd: opts.cwd, projectRoot: opts.projectRoot ?? opts.cwd,
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
    "usage: marvinx init <target> [--only kinds] [--source <path>] [--target claude]",
    "                             [--dry-run] [--offline]",
    "",
    "  <target>           <pack> | <pack>/skills/<name> | <pack>/commands/<name> | <pack>/agents/<name>",
    "  --only kinds       comma-separated subset: skills,commands,agents (whole-pack only)",
    "  --source <path>    explicit local clone of marvin-toolkit (skips tarball download)",
    "  --target <name>    only `claude` is supported in this phase",
    "  --dry-run          print the plan and exit; do not write anything",
    "  --offline          skip the GitHub tarball fallback resolver",
  ].join("\n");
}
