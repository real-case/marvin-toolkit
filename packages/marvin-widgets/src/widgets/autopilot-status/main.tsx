import { render } from "preact";
import { AutopilotStatusWidget } from "./AutopilotStatusWidget";

// Browser entry for the built `ui://marvin/autopilot-status.html` document. Mounts the
// production widget (no seam → the live `useApp()` path); vite-plugin-singlefile inlines this
// module into the committed HTML the server serves.
const container = document.getElementById("root");
if (container) {
  render(<AutopilotStatusWidget />, container);
} else {
  console.error("marvin autopilot-status widget: #root element not found; nothing mounted");
}
