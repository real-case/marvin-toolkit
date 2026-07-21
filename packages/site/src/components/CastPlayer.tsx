/**
 * CastPlayer.tsx (spec 012-website-terminal-recordings, F4) — one pipeline stage's recording.
 *
 * Server-renders the poster (command, caption, play button, duration) exactly as the static page
 * did, and mounts the real asciinema player only when the visitor presses play. Hydrates with
 * `client:visible` — never `client:only`, which skips the server render and would leave the poster
 * (and therefore the command text) out of the shipped HTML entirely.
 *
 * WEIGHT DISCIPLINE — the reason this file looks the way it does. The player is ~330 KB raw, most of
 * it an inlined WebAssembly terminal emulator that minification cannot shrink, plus 19 KB of vendor
 * CSS. None of it may touch the initial page (FR-15 / the Lighthouse ≥95 budget), so BOTH the module
 * and the stylesheet load inside the activation effect:
 *
 *   - The module via `await import("asciinema-player")`. A module-level import would fold those
 *     330 KB into this island's OWN chunk — and stage 1 is above the fold, so `client:visible`
 *     fetches that chunk essentially at page load. AC5's "at least one new script request after
 *     activation" clause exists to catch exactly that regression.
 *   - The stylesheet via a runtime <link> to /casts/asciinema-player.css, which gen-casts.mjs copies
 *     into public/. This is the spec's pre-authorized route rather than a dynamic CSS import: Astro
 *     inlines an island's imported CSS into the page head (measured on WidgetDemo.css), and how it
 *     treats a *dynamic* CSS import is unverified. Shipping the sheet through public/ bypasses the
 *     bundler entirely — the same trick gen-widget-demos.mjs uses for the committed widget HTML —
 *     and it gives the stylesheet a stable, unhashed URL for AC5 to assert on.
 *
 * The stylesheet is structural, not decoration: it absolutely positions every terminal row and span,
 * so a player mounted without it renders a terminal collapsed to a point rather than an error.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { formatDuration, type Cast } from "../data/casts";
import "./CastPlayer.css";

/** poster → the static frame; loading → player in flight; playing → player mounted and running. */
type Status = "poster" | "loading" | "playing";

/** Resolve a site-root-relative generated asset against the configured base path. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const asset = (path: string) => `${BASE}${path}`;

/** The vendor stylesheet, copied into public/casts/ by scripts/gen-casts.mjs. */
const VENDOR_CSS_HREF = asset("/casts/asciinema-player.css");

/**
 * Inject the vendor stylesheet once for the whole page, no matter how many stages are activated.
 * Module-level, so all four islands share the single <link> and the single in-flight promise.
 */
let vendorStylesheet: Promise<void> | undefined;

function loadVendorStylesheet(): Promise<void> {
  if (vendorStylesheet) return vendorStylesheet;

  vendorStylesheet = new Promise<void>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = VENDOR_CSS_HREF;
    link.dataset.castVendor = "";
    // Resolve on error as well as load. A missing stylesheet renders a collapsed terminal, which is
    // bad — but a promise that never settles would strand the poster on "loading player…" forever,
    // which is worse and much harder to diagnose.
    const settle = () => resolve();
    link.addEventListener("load", settle, { once: true });
    link.addEventListener("error", settle, { once: true });
    document.head.append(link);
  });

  return vendorStylesheet;
}

export interface CastPlayerProps {
  /** One row of the generated manifest (src/data/casts.json). */
  cast: Cast;
}

export function CastPlayer({ cast }: CastPlayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [status, setStatus] = useState<Status>("poster");

  const activate = useCallback(() => {
    setActivated(true);
    setStatus("loading");
  }, []);

  useEffect(() => {
    if (!activated) return;

    let disposed = false;
    // Captured in the effect scope rather than a ref so the cleanup below is this run's single
    // disposal point. `activated` only ever flips false → true, so this effect runs once and its
    // cleanup is the unmount path; the later setStatus("playing") does not re-trigger it.
    let instance: { dispose(): void; play(): unknown } | null = null;

    void (async () => {
      const [player] = await Promise.all([import("asciinema-player"), loadVendorStylesheet()]);
      if (disposed) return;

      const mount = mountRef.current;
      if (!mount) return;

      instance = player.create({ url: asset(cast.file) }, mount, {
        // Never autoplay (FR-15). The player is created only in response to the play button, and
        // play() below is that press being honoured — not the page starting on its own.
        autoPlay: false,
        controls: true,
        // Scales the 64-column grid to the container instead of letting it push the page sideways.
        fit: "width",
        poster: cast.poster,
        idleTimeLimit: 2,
        theme: "asciinema",
        // Indirection through the site token, which CastPlayer.css also bridges onto the player's
        // own --term-font-family, so the terminal uses the same mono face as every other command.
        terminalFontFamily: "var(--font-mono)",
      });

      setStatus("playing");
      // Safe immediately after create(): the player's Core.play() awaits init() internally.
      void instance.play();
    })();

    return () => {
      disposed = true;
      instance?.dispose();
      instance = null;
    };
  }, [activated, cast]);

  const playing = status === "playing";

  return (
    <div class="cast" data-stage={cast.key} data-status={status}>
      <div class="cast-stage" ref={mountRef} hidden={!playing} />

      {/* The poster stays mounted until the player is actually running, so there is never a blank
          bordered box between the press and the first frame. */}
      <div class="cast-poster" hidden={playing}>
        <span class="cast-cmd">➜ {cast.command}</span>
        <span class="cast-caption">{cast.caption}</span>

        {status === "poster" ? (
          <button
            type="button"
            class="cast-play"
            // Named for its stage: "Play" alone would give all four buttons the same accessible
            // name, which is what the a11y note in the spec's Security / NFR section rules out.
            aria-label={`Play the ${cast.command} recording`}
            onClick={activate}
          >
            <span class="cast-circ">
              <span class="cast-tri" />
            </span>
          </button>
        ) : (
          <span class="cast-loading">loading player…</span>
        )}

        <span class="cast-dur">{formatDuration(cast.duration)}</span>
      </div>
    </div>
  );
}

export default CastPlayer;
