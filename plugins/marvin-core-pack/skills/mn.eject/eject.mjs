#!/usr/bin/env node
// CLI wrapper for the mn.eject skill. Pure logic lives in eject-core.mjs;
// this file just delegates argv → run() and propagates the exit code.
//
// Re-exports the public surface of eject-core so importers (notably the
// test suite) can keep using `from "./eject.mjs"` paths unchanged.

import path from "node:path";
import { run } from "./eject-core.mjs";

export * from "./eject-core.mjs";

const isMain = import.meta.url === `file://${process.argv[1]}`
  || (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(path.sep).join("/")));

if (isMain) {
  run(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`unexpected error: ${err.stack ?? err.message}\n`);
    process.exit(1);
  });
}
