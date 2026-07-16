import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { TOKENS } from "../theme";

/**
 * The reusable master-detail shell (ADR-0024) — a keyboard-navigable list on the
 * left, one selected row's detail on the right. Four widgets reuse the primitive
 * (task-list, task-detail, handoffs, tracker-list); the audit and reports
 * browsers build on the same shell.
 *
 * It owns only selection state and renders through caller-supplied renderers, so
 * it stays domain-agnostic: `renderRow` draws one item in the list, `renderDetail`
 * draws the selected item's pane. An empty `items` renders `emptyLabel` instead of
 * an empty split — never a crash.
 *
 * Styling follows the family theme (docs/design/reports-widget.md): the primitive
 * carries no palette of its own — every color is a `var(--…)` token reference
 * resolved by the `.mvroot` scope the OWNING WIDGET renders (primitives are never
 * wrapped in `MvRoot` themselves), and no font family or size is set here — the
 * base typography (13px/1.5 system sans) cascades from `.mvroot` through the
 * shell, and rows reset the UA button font back to it with `font: inherit`.
 */
export interface ListDetailProps<T> {
  /** The rows to render. An empty array renders the empty state. */
  items: T[];
  /** Stable key per item (used for React keys and row ids). */
  getKey: (item: T, index: number) => string;
  /** Render one list row; `selected` lets the caller style the active row. */
  renderRow: (item: T, selected: boolean) => ReactNode;
  /** Render the selected item's detail pane. */
  renderDetail: (item: T) => ReactNode;
  /** Shown when `items` is empty. Defaults to a plain placeholder. */
  emptyLabel?: ReactNode;
  /** Accessible label for the listbox. */
  ariaLabel?: string;
}

// ── themed styling ───────────────────────────────────────────────────────────
// The list column width (media query) and the row hover state (pseudo-class)
// cannot live inline, so the primitive injects one id-keyed <style> element at
// render time — the same idempotent lifecycle as MvRoot's token sheet. Being a
// JS string, the rules survive the vite-singlefile build untouched.

/** id of the injected `<style>` element — the once-per-document key. */
const LIST_DETAIL_STYLE_ID = "mv-listdetail-styles";

// Row padding is 9px 12px and EVERY row — including the LAST — keeps its 0.5px
// bottom border (design decision D: the column closes with a rule even when the
// detail pane is taller). Do not reintroduce a last-row border drop.
const LIST_DETAIL_CSS = `
.mvld-list{list-style:none;margin:0;padding:0;width:15.5rem;flex:none;overflow-y:auto;border-right:0.5px solid ${TOKENS.bd}}
@media (max-width:640px){.mvld-list{width:11rem}}
.mvld-row{display:block;width:100%;text-align:left;padding:9px 12px;border:none;border-bottom:0.5px solid ${TOKENS.bd};background:transparent;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer}
.mvld-row:hover{background:${TOKENS.srf2}}
`;

/**
 * Put the primitive's stylesheet into the document exactly once — keyed by the
 * element id, so repeat renders and multiple ListDetails are no-ops after the
 * first. Runs at render time (before the children's first paint), like MvRoot.
 */
function ensureListDetailStyles(): void {
  if (typeof document === "undefined" || document.getElementById(LIST_DETAIL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LIST_DETAIL_STYLE_ID;
  style.textContent = LIST_DETAIL_CSS;
  document.head.appendChild(style);
}

// The split shell. Typography and text color are deliberately NOT set here —
// they cascade from the owning widget's `.mvroot` (the family base).
const shellStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
};

// Selection = accent tint + a 2px inset rail. The rail is an inset box-shadow —
// a border technique kept deliberately (not an elevation shadow): a real left
// border would shift the label 2px sideways whenever selection lands on the row.
// Inline (not a class) so it always beats the `.mvld-row:hover` rule — a hovered
// selected row stays on the accent tint, matching the approved mockup.
const rowSelectedStyle: CSSProperties = {
  background: TOKENS.acbg,
  boxShadow: `inset 2px 0 0 ${TOKENS.ac}`,
};

// Quiet placeholder: meta-grade text on the inherited canvas.
const emptyStyle: CSSProperties = {
  color: TOKENS.t3,
  fontSize: "12.5px",
  padding: "14px 16px",
};

/**
 * Master-detail list. Selection starts on the first row and moves with click or
 * ArrowUp/ArrowDown; the detail pane always reflects the selected row.
 *
 * The listbox is the single tab stop (rows are `tabIndex={-1}`), points assistive
 * tech at the active row via `aria-activedescendant`, and keeps that row visible
 * by scrolling it into view whenever the selection moves.
 */
export function ListDetail<T>({
  items,
  getKey,
  renderRow,
  renderDetail,
  emptyLabel,
  ariaLabel = "items",
}: ListDetailProps<T>) {
  ensureListDetailStyles();
  const [selected, setSelected] = useState(0);
  // Per-instance id prefix so several ListDetails on one page never collide on
  // option ids — aria-activedescendant must reference a document-unique id.
  const idPrefix = useId();
  // One ref slot per row (callback refs, not id-string DOM queries) so the
  // scroll effect below can reach the active row's element directly.
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => Math.min(i + 1, items.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (event.key === "Home") {
        event.preventDefault();
        setSelected(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setSelected(items.length - 1);
      }
    },
    [items.length],
  );

  // Selection can dangle past the end if `items` shrank between renders; clamp on
  // read so the detail pane never indexes out of bounds.
  const activeIndex = Math.min(selected, items.length - 1);

  // Keep the active row visible as arrow/Home/End move the selection. An effect
  // keyed on the index (not code in the key handler) runs after the row has
  // re-rendered; `block: "nearest"` makes it a no-op for click selection, which
  // is on-screen by definition. happy-dom may omit scrollIntoView — guard it.
  useEffect(() => {
    const el = rowRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (items.length === 0) {
    return (
      <div data-testid="list-detail-empty" style={emptyStyle}>
        {emptyLabel ?? "Nothing to show."}
      </div>
    );
  }

  const activeItem = items[activeIndex];

  return (
    <div style={shellStyle}>
      <ul
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        aria-activedescendant={`${idPrefix}-opt-${activeIndex}`}
        onKeyDown={onKeyDown}
        className="mvld-list"
      >
        {items.map((item, index) => {
          const isSelected = index === activeIndex;
          return (
            <li key={getKey(item, index)} role="presentation">
              <button
                type="button"
                role="option"
                id={`${idPrefix}-opt-${index}`}
                aria-selected={isSelected}
                // The listbox is the one tab stop; rows are reached with the
                // arrow keys, so they must not add 40 stops to the tab order.
                tabIndex={-1}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                onClick={() => setSelected(index)}
                className="mvld-row"
                style={isSelected ? rowSelectedStyle : undefined}
              >
                {renderRow(item, isSelected)}
              </button>
            </li>
          );
        })}
      </ul>
      <div data-testid="list-detail-pane" style={{ flex: 1, minWidth: 0, padding: "14px 16px" }}>
        {renderDetail(activeItem)}
      </div>
    </div>
  );
}
