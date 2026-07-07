import { render } from "preact";
import { AuditWidget } from "./AuditWidget";

// Browser entry for the built `ui://marvin/audit.html` document. Mounts the
// production widget (no seam → the live `useApp()` path). vite-plugin-singlefile
// inlines this module into the committed HTML the server serves. Mounts via
// Preact's `render` — @preact/preset-vite does not alias the react-dom/client
// subpath, and `render` is Preact's native mount.
const container = document.getElementById("root");
if (container) {
  render(<AuditWidget />, container);
} else {
  // Should never happen (index.html always ships #root), but fail loudly rather
  // than mount nothing silently if a future entry document drops the node.
  console.error("marvin audit widget: #root element not found; nothing mounted");
}
