// CommandCatalog.tsx (spec 010, F1) — the /commands search + filter island (FR-13/FR-14).
//
// The site's FIRST framework island. It owns the whole catalog subtree: the search field, the
// group chips, the live count, every command card, and the empty state. The cards are rendered
// HERE in JSX rather than reusing CodeCommand.astro, because an Astro component cannot render
// inside a Preact island — so the example row reproduces the shared `.command/.code/.copy`
// markup, and its copy button is served by the ONE delegated handler in Base.astro (F4).
//
// Data: the typed catalog is imported directly rather than passed as props — Astro serializes
// island props into the HTML for hydration, and the corpus is ~24KB, so props would ship it
// twice. Imported, it lives once in the client bundle.
//
// Rendering: Astro server-renders this island, so the full catalog is in the initial HTML and
// the page works with no JS; `client:load` then hydrates it for filtering. A deep-linked
// filtered URL (?q=/?group=) therefore applies its filter just after hydration, not at first
// paint — the documented trade-off in the spec (AC3/AC5).
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { catalog, type CatalogCommand } from "../data/catalog";
import "./CommandCatalog.css";

const { groups, commands } = catalog;
const ALL = "all";
const GROUP_KEYS = groups.map((g) => g.key);

/**
 * Case-insensitive subsequence test — every character of `needle` appears in `haystack` in
 * order, not necessarily adjacent. Both arguments must already be lower-cased.
 */
function isSubsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** Strip everything that is not a letter or digit, so "task start" and "task-start" agree. */
function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

/**
 * Does a command match the query?
 *
 * A deliberate deviation from spec 010, which says "subsequence-fuzzy over
 * name/description/joined-phrases": a subsequence test over a 100+ character description
 * matches almost any short query, which would make the filter useless (and AC1 unprovable).
 * So the fuzzy subsequence applies to the short `name` only — where skipping characters
 * genuinely helps ("tskst" → task-start) — while `description`, `blurb` and the trigger
 * phrases use a plain substring test. `blurb` is searched as well as the three fields the
 * spec names: it is the one-line synopsis printed on the card, so a user searching words they
 * can see expects a hit. Recorded as a SPEC GAP against spec 010.
 *
 * The name test is separator-insensitive and tolerates a pasted invocation, so "task start",
 * "task-start" and "/marvin:task-start" all find the same command.
 */
function matches(cmd: CatalogCommand, query: string): boolean {
  const needle = query
    .trim()
    .toLowerCase()
    .replace(/^\/?(?:marvin:)?/, "");
  if (!needle) return true;
  const compactNeedle = compact(needle);
  return (
    (compactNeedle !== "" && isSubsequence(compact(cmd.name.toLowerCase()), compactNeedle)) ||
    cmd.description.toLowerCase().includes(needle) ||
    cmd.blurb.toLowerCase().includes(needle) ||
    cmd.phrases.join(" ").toLowerCase().includes(needle)
  );
}

/** Read {query, group} from the current URL. Returns defaults during SSR (no `location`). */
function readParams(): { query: string; group: string } {
  if (typeof location === "undefined") return { query: "", group: ALL };
  const params = new URLSearchParams(location.search);
  const group = params.get("group") ?? ALL;
  return {
    query: params.get("q") ?? "",
    // an unknown ?group= falls back to "all" rather than rendering an empty catalog
    group: GROUP_KEYS.includes(group) ? group : ALL,
  };
}

export default function CommandCatalog() {
  // Start from the server-rendered state — the unfiltered catalog. A deep link's ?q=/?group=
  // is applied just AFTER mount rather than seeded into these initializers, and that is
  // deliberate: Preact reuses the server-rendered DOM when it hydrates and skips prop updates
  // on it, so seeded state would leave the input's `value` and the active chip's `class`
  // stale while the filter silently applied. Applying it as a real post-hydration state
  // change makes Preact patch the DOM properly (AC3 — "restores … after hydration").
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(ALL);
  const inputRef = useRef<HTMLInputElement>(null);
  // The URL writer must not fire on the mount pass, where it would clobber a deep link with
  // the not-yet-applied defaults.
  const skipUrlWrite = useRef(true);

  // Adopt a shared/deep-linked filter, once, on mount.
  useEffect(() => {
    const initial = readParams();
    setQuery(initial.query);
    setGroup(initial.group);
  }, []);

  // Reflect the filter in the URL so a filtered view is shareable (FR-14). replaceState, not
  // pushState — filter keystrokes must not pile up in the back button.
  useEffect(() => {
    if (skipUrlWrite.current) {
      skipUrlWrite.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (group !== ALL) params.set("group", group);
    const qs = params.toString();
    try {
      history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    } catch {
      // This fires once per keystroke, and Safari rate-limits replaceState (~100 calls / 30s)
      // by throwing. A shareable URL is a nicety; never let it break the search.
    }
  }, [query, group]);

  // "/" focuses the search field, unless the user is already typing somewhere. preventDefault
  // stops the slash itself from landing in the field we just focused (AC4).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visible = useMemo(
    () => commands.filter((cmd) => (group === ALL || cmd.group === group) && matches(cmd, query)),
    [query, group],
  );

  // Keep the seven groups in catalog order; drop the ones with nothing left to show.
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, commands: visible.filter((cmd) => cmd.group === g.key) }))
        .filter((g) => g.commands.length > 0),
    [visible],
  );

  return (
    <div class="catalog">
      <div class="searchisland">
        <div class="searchrow">
          <div class="search">
            <input
              ref={inputRef}
              type="search"
              class="searchinput"
              value={query}
              onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
              placeholder="Search by name, description, or trigger phrase…"
              aria-label="Search commands by name, description, or trigger phrase"
            />
            <span class="kbd" aria-hidden="true">
              /
            </span>
          </div>
          <span class="shown" aria-live="polite">
            {visible.length} shown
          </span>
        </div>
        <div class="filters">
          {[ALL, ...GROUP_KEYS].map((key) => (
            <button
              key={key}
              type="button"
              class={key === group ? "fchip on" : "fchip"}
              aria-pressed={key === group}
              onClick={() => setGroup(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <p class="empty">
          No commands match that search. Try a different term or clear the filters.
        </p>
      ) : (
        visibleGroups.map((g) => (
          <section class="cmdgroup" key={g.key}>
            <div class="grouphead">
              <h2 class="gname">{g.key}</h2>
              <span class="gcount">{g.commands.length} commands</span>
            </div>
            <p class="gblurb">{g.blurb}</p>
            <div class="cmdgrid">
              {g.commands.map((cmd) => (
                <article class="cmd" key={cmd.name}>
                  <div class="cmdhead">
                    <span class="name">
                      <b>/marvin:</b>
                      <span class="cn">{cmd.name}</span>
                    </span>
                    <span class="badge b-acc">{cmd.group}</span>
                    {cmd.human && <span class="badge b-amb human-badge">human-run</span>}
                  </div>
                  <p class="blurb">{cmd.blurb}</p>
                  <p class="desc">{cmd.description}</p>
                  {cmd.example && (
                    <div class="cmdex">
                      <div class="command">
                        {/* single text child — the delegated copy handler reads .textContent */}
                        <code class="code">{cmd.example}</code>
                        <button type="button" class="copy" aria-label={`Copy ${cmd.example}`}>
                          copy
                        </button>
                      </div>
                    </div>
                  )}
                  <div class="trig">
                    {cmd.phrases.map((phrase) => (
                      <i key={phrase}>{phrase}</i>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
