import { createRoot } from "react-dom/client";
import { TaskListWidget } from "./TaskListWidget";

// Browser entry for the built `ui://marvin/task-list.html` document. Mounts the
// production widget (no seam → the live `useApp()` path). vite-plugin-singlefile
// inlines this module into the committed HTML the server serves.
const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<TaskListWidget />);
} else {
  // Should never happen (index.html always ships #root), but fail loudly rather
  // than mount nothing silently if a future entry document drops the node.
  console.error("marvin task-list widget: #root element not found; nothing mounted");
}
