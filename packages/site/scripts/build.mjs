// Node-version build guard (spec 004-website-scaffold, F5).
//
// Astro 7 requires Node >=22.12.0, but the repo's CI matrix also runs Node 20 — the
// plugin's supported floor, which the site must not raise. Root `npm run build` fans out
// to every workspace on both legs, so on Node <22.12 this guard no-ops with a notice
// (keeping the Node-20 leg green); on a supported Node it runs the real `astro build`
// and forwards its exit code. The real build + e2e run on the Node-22 CI leg.
import { spawnSync } from "node:child_process";

const REQUIRED = [22, 12, 0]; // matches Astro 7.1.x's Node floor
const current = process.versions.node.split(".").map(Number);

// Numeric major.minor.patch comparison — a string compare would be wrong here
// ("v22.9.0" sorts ABOVE "v22.12.0" lexically because "9" > "1"). Returns true when
// `cur` >= `req`.
function meets(cur, req) {
  for (let i = 0; i < req.length; i++) {
    const c = cur[i] ?? 0;
    if (c > req[i]) return true;
    if (c < req[i]) return false;
  }
  return true;
}

if (!meets(current, REQUIRED)) {
  console.log(
    `[marvin-site] Node ${process.versions.node} < ${REQUIRED.join(".")} — skipping ` +
      "`astro build` (the site targets Node >=22.12; this keeps the Node-20 CI leg green).",
  );
  process.exit(0);
}

const result = spawnSync("astro build", { stdio: "inherit", shell: true });
if (result.error) {
  console.error(`[marvin-site] failed to spawn \`astro build\`: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
