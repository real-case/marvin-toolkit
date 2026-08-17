/**
 * WidgetDemo.tsx (spec 011-website-widget-embeds, F4) — the live widget-demo islands.
 *
 * Two exports over one shared stage:
 *   <WidgetDemo>   — a single demo that mounts when scrolled into view (the Home teaser, FR-9).
 *                    Its Astro children are the static fallback, revealed if the frame fails.
 *   <WidgetCanvas> — the /toolbox demo canvas (FR-16): a widget picker, the Live/Screenshot
 *                    toggle, and one frame at a time. Its Screenshot side and its failure
 *                    fallback both CLONE the page's own `.wmini[data-widget]` block, so the
 *                    static artwork keeps exactly one authored source.
 *
 * Both hydrate with `client:visible` — never `client:only`, which skips the server render, so
 * slotted fallback markup would never be serialized and <WidgetDemo>'s fallback would silently
 * not exist.
 *
 * Weight discipline: each widget document is ~300 KB, so a frame is created only when its stage
 * is actually active — on intersection for the teaser, on selection for the canvas — and is torn
 * down when it stops being active. Nothing is fetched at page load.
 *
 * Theming (FR-17): the committed widgets follow the OS scheme and ignore the protocol's own theme
 * channel, so the parent reaches into the frame and sets `data-theme` on its `.mvroot` (the element
 * the token overrides key on) plus `color-scheme` on its documentElement (which the `.mvroot` scope
 * does not reach, leaving scrollbars and form controls on the OS scheme otherwise). This is what
 * `sandbox="allow-scripts allow-same-origin"` buys.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { mountWidgetHost, type WidgetHostHandle } from "../lib/widget-host";
import "./WidgetDemo.css";

type SiteTheme = "light" | "dark";
type StageStatus = "idle" | "loading" | "live" | "failed";

/** Where the generated demo assets are served from (see scripts/gen-widget-demos.mjs). */
const DEMO_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/widget-demos`;

/**
 * Track the site's theme. Seeded in a mount effect rather than a `useState` initializer:
 * `document` is client-only, and reading it during the hydration render would produce a value
 * Preact never patches onto already-server-rendered DOM.
 */
function useSiteTheme(): SiteTheme | null {
  const [theme, setTheme] = useState<SiteTheme | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    read();
    // ThemeToggle.astro sets the attribute directly and dispatches no event, so observing the
    // attribute is the only available subscription.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * The framed document, or null if it is unreachable. Cross-origin access would throw; ours is
 * same-origin by construction, but a failed or torn-down load still leaves contentDocument null.
 */
function frameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

/** Push the site theme into a framed widget document. No-ops until the widget has rendered. */
function applyFrameTheme(iframe: HTMLIFrameElement | null, theme: SiteTheme | null) {
  if (!iframe || !theme) return;
  const doc = frameDocument(iframe);
  if (!doc) return;
  doc.documentElement.style.colorScheme = theme;
  const mvroot = doc.querySelector<HTMLElement>(".mvroot");
  if (mvroot) mvroot.dataset.theme = theme;
}

interface StageOptions {
  /** Widget file name, e.g. "help" — matches /widget-demos/<widget>.{html,json}. */
  widget: string;
  /** Accessible name for the frame. */
  title: string;
  /** Whether this stage should currently hold a live frame. */
  active: boolean;
}

/**
 * The shared frame lifecycle: fetch the fixture, create the frame, mount the host, hand over the
 * payload, keep the theme in sync, and tear all of it down when the stage goes inactive.
 *
 * Order matters — the fixture is fetched and the host is attached BEFORE `src` is set, so the
 * framed document cannot boot and fire `ui/initialize` before anyone is listening.
 */
function useWidgetStage({ widget, title, active }: StageOptions) {
  const mountRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<StageStatus>("idle");
  const theme = useSiteTheme();

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return;
    }

    let disposed = false;
    let host: WidgetHostHandle | undefined;
    let frame: HTMLIFrameElement | undefined;
    setStatus("loading");

    void (async () => {
      let payload: Record<string, unknown>;
      try {
        const response = await fetch(`${DEMO_BASE}/${widget}.json`);
        if (!response.ok) throw new Error(`fixture ${response.status}`);
        payload = (await response.json()) as Record<string, unknown>;
      } catch {
        if (!disposed) setStatus("failed");
        return;
      }
      if (disposed) return;

      const mount = mountRef.current;
      if (!mount) return;

      frame = document.createElement("iframe");
      frame.className = "wd-frame";
      frame.title = title;
      // allow-same-origin is what lets the parent reach .mvroot for FR-17; the framed content is
      // this repo's own committed build artifact, served from this origin, with no user input.
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      mount.appendChild(frame);
      iframeRef.current = frame;

      host = mountWidgetHost({
        iframe: frame,
        payload,
        onResize: (height) => {
          if (frame) frame.style.height = `${Math.max(height, 1)}px`;
        },
      });

      frame.src = `${DEMO_BASE}/${widget}.html`;

      try {
        await host.ready;
        if (disposed) return;
        setStatus("live");
        applyFrameTheme(
          frame,
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        );
      } catch {
        // Handshake stalled, the document 404'd, or the stage was torn down mid-flight.
        //
        // Tear the frame down rather than just flipping state. Leaving it mounted would keep the
        // host's window listener alive (only dispose() detaches it) and — because the effect
        // cleanup does not run here, `active` being unchanged — would strand a blank min-height
        // frame above the revealed fallback. That empty bordered box is verbatim what AC6's
        // failure clause says must not happen.
        host?.dispose();
        frame?.remove();
        frame = undefined;
        host = undefined;
        // Guarded like setStatus: iframeRef is shared with the successor stage, and only this
        // effect's own run may clear it. Unguarded it is currently still safe — the rejection
        // continuation drains before a successor's fetch resolves — but that is an argument about
        // microtask ordering, and the guard removes the need to make it.
        if (!disposed) {
          iframeRef.current = null;
          setStatus("failed");
        }
      }
    })();

    return () => {
      disposed = true;
      host?.dispose();
      frame?.remove();
      iframeRef.current = null;
    };
  }, [active, widget, title]);

  // Re-apply on every site theme change while a frame is live.
  useEffect(() => {
    if (status !== "live") return;
    applyFrameTheme(iframeRef.current, theme);
  }, [theme, status]);

  return { mountRef, status };
}

/**
 * Clone the page's static mini for a widget into `target`. The original stays in the journey grid
 * as the authored source; the clone is decorative, so it is hidden from assistive tech to avoid
 * announcing the same content twice.
 */
function useMiniClone(target: HTMLDivElement | null, widget: string, show: boolean) {
  useEffect(() => {
    if (!target) return;
    target.replaceChildren();
    if (!show) return;
    const source = document.querySelector(`.wmini[data-widget="${widget}"]`);
    if (!source) return;
    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("wd-clone");
    target.appendChild(clone);
    return () => target.replaceChildren();
  }, [target, widget, show]);
}

export interface WidgetDemoProps {
  widget: string;
  title: string;
  /** The static fallback, authored in Astro and passed as children. */
  children?: ComponentChildren;
}

/**
 * One lazily-mounted demo (Home teaser). Renders its slotted fallback until the frame is live,
 * then hides it — so a visitor with the frame blocked still sees the static panel, and a visitor
 * who never scrolls this far downloads nothing.
 */
export function WidgetDemo({ widget, title, children }: WidgetDemoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { mountRef, status } = useWidgetStage({ widget, title, active: visible });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The stage and the fallback are strictly complementary: exactly one is visible at any moment.
  // Anything looser shows the static panel and a blank min-height frame together while the demo
  // loads — a guaranteed layout shift on every visit, on the page whose Lighthouse budget this
  // spec is trying to protect — and leaves an empty bordered box behind on failure.
  const live = status === "live";
  return (
    <div class="wd" data-widget={widget} data-status={status} ref={rootRef}>
      <div class="wd-stage" ref={mountRef} hidden={!live} />
      <div class="wd-fallback" hidden={live}>
        {children}
      </div>
    </div>
  );
}

export interface WidgetCanvasEntry {
  /** Widget file name — /widget-demos/<key>.html. */
  key: string;
  /** The command the widget answers, e.g. "/marvin:help". */
  label: string;
}

export interface WidgetCanvasProps {
  widgets: WidgetCanvasEntry[];
  /** Which widget the canvas opens on. */
  initial?: string;
}

/**
 * The /toolbox demo canvas. Owns the widget picker and the Live/Screenshot toggle that spec 010
 * shipped as state-only; the Screenshot side and the failure fallback both clone the selected
 * widget's static mini from the journey grid above.
 */
export function WidgetCanvas({ widgets, initial }: WidgetCanvasProps) {
  const [selected, setSelected] = useState(initial ?? widgets[0]?.key ?? "");
  const [stage, setStage] = useState<"live" | "shot">("live");
  const [cloneTarget, setCloneTarget] = useState<HTMLDivElement | null>(null);

  const { mountRef, status } = useWidgetStage({
    widget: selected,
    title: `${selected} widget demo`,
    active: stage === "live",
  });

  // The static mini stands in whenever we are not showing a working live frame.
  const showClone = stage === "shot" || status === "failed";
  useMiniClone(cloneTarget, selected, showClone);

  const cloneRef = useCallback((node: HTMLDivElement | null) => setCloneTarget(node), []);
  const current = widgets.find((entry) => entry.key === selected);

  return (
    <div class="canvas wd-canvas" data-widget={selected} data-stage={stage} data-status={status}>
      <div class="wd-controls">
        <div class="toggle" role="group" aria-label="Demo mode">
          <button
            type="button"
            class={stage === "live" ? "on" : undefined}
            aria-pressed={stage === "live"}
            data-stage="live"
            onClick={() => setStage("live")}
          >
            Live demo
          </button>
          <button
            type="button"
            class={stage === "shot" ? "on" : undefined}
            aria-pressed={stage === "shot"}
            data-stage="shot"
            onClick={() => setStage("shot")}
          >
            Screenshot
          </button>
        </div>
        <div class="wd-picker" role="group" aria-label="Choose a widget">
          {widgets.map((entry) => (
            <button
              type="button"
              key={entry.key}
              class={entry.key === selected ? "on" : undefined}
              aria-pressed={entry.key === selected}
              data-widget={entry.key}
              onClick={() => setSelected(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div class="stage-area wd-stage-area">
        <div class="wd-stage" ref={mountRef} hidden={showClone} />
        <div class="wd-clone-host" ref={cloneRef} hidden={!showClone} />
        <p class="wd-note" hidden={status !== "loading" || showClone}>
          loading {current?.label ?? selected}…
        </p>
      </div>
    </div>
  );
}
