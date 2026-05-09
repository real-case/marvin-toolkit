#!/usr/bin/env node
// marvin — tool-agnostic installer for Marvin Toolkit packs.
// Subcommands: init | update | status | list

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

import { init } from "../src/commands/init.mjs";
import { update } from "../src/commands/update.mjs";
import { status } from "../src/commands/status.mjs";
import { list } from "../src/commands/list.mjs";

const HELP = `\
marvin — install Marvin Toolkit packs into a project

usage:
  marvin init <target> [--only kinds] [--source <path>] [--target claude]
                        [--dry-run] [--offline]
  marvin update [--pack <name>] [--source <path>] [--offline]
  marvin status [--source <path>] [--offline] [--json]
  marvin list [--source <path>] [--offline] [--json]
  marvin --version
  marvin --help

flags common to most commands:
  --source <path>   explicit local clone of marvin-toolkit (skips tarball)
  --offline         skip the GitHub tarball fallback resolver
  --json            emit machine-readable output (status, list)

env:
  MARVIN_SOURCE     same as --source
  MARVIN_REPO       override the GitHub repo for tarball fetches (default: real-case/marvin-toolkit)
  MARVIN_REF        override the branch/tag to fetch (default: main)
`;

function parseArgv(argv) {
  const out = {
    cmd: null,
    target: null,
    pack: null,
    source: null,
    only: null,
    adapter: "claude",
    dryRun: false,
    offline: false,
    json: false,
    help: false,
    version: false,
    rest: [],
  };
  if (argv.length === 0) return out;
  // Top-level flags first.
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--offline") out.offline = true;
    else if (a === "--json") out.json = true;
    else if (a === "--source") out.source = argv[++i];
    else if (a.startsWith("--source=")) out.source = a.slice("--source=".length);
    else if (a === "--pack") out.pack = argv[++i];
    else if (a.startsWith("--pack=")) out.pack = a.slice("--pack=".length);
    else if (a === "--only") out.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length).split(",").filter(Boolean);
    else if (a === "--target") out.adapter = argv[++i];
    else if (a.startsWith("--target=")) out.adapter = a.slice("--target=".length);
    else positional.push(a);
  }
  out.cmd = positional[0] ?? null;
  out.target = positional[1] ?? null;
  out.rest = positional.slice(2);
  return out;
}

async function readPackageVersion() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await fs.readFile(path.join(here, "..", "package.json"), "utf8"));
  return pkg.version;
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.version) { process.stdout.write(`${await readPackageVersion()}\n`); return 0; }
  if (opts.help || !opts.cmd) { process.stdout.write(HELP); return opts.cmd ? 0 : (opts.help ? 0 : 2); }

  switch (opts.cmd) {
    case "init":   return init(opts);
    case "update": return update(opts);
    case "status": return status(opts);
    case "list":   return list(opts);
    default:
      process.stderr.write(`unknown subcommand: ${opts.cmd}\n${HELP}`);
      return 2;
  }
}

main().then((code) => process.exit(code ?? 0)).catch((err) => {
  process.stderr.write(`unexpected error: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
