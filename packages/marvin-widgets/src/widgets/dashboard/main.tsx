import { render } from "preact";
import { DashboardWidget } from "./DashboardWidget";

// Browser entry for the built `ui://marvin/dashboard.html` document. Mounts the
// production widget (no seam → the live `useApp()` path). vite-plugin-singlefile
// inlines this module into the committed HTML the server serves. Mounts via Preact's
// `render` — @preact/preset-vite does not alias the react-dom/client subpath, and
// `render` is Preact's native mount.
const container = document.getElementById("root");
if (container) {
  render(<DashboardWidget />, container);
} else {
  // Should never happen (index.html always ships #root), but fail loudly rather than
  // mount nothing silently if a future entry document drops the node.
  console.error("marvin dashboard widget: #root element not found; nothing mounted");
}
