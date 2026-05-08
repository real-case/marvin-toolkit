// Claude target adapter. Re-exports the canonical implementation from
// eject-core.mjs (where it lives so the in-skill `eject.mjs` can use it
// without depending on the cli/ package). This file is the entry point
// the registry consults — never import it directly from cli/src/commands/.

export { claudeAdapter as default } from "../lib/eject-core.mjs";
