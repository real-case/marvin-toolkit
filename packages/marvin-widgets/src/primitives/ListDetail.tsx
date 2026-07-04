import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";

/**
 * The reusable master-detail shell (ADR-0024) — a keyboard-navigable list on the
 * left, one selected row's detail on the right. The primitive 4 of the 8 planned
 * widgets reuse (task-list, task-detail, handoffs, tracker-list); this slice ships
 * it with the task-list widget as its first consumer.
 *
 * It owns only selection state and renders through caller-supplied renderers, so
 * it stays domain-agnostic: `renderRow` draws one item in the list, `renderDetail`
 * draws the selected item's pane. An empty `items` renders `emptyLabel` instead of
 * an empty split — never a crash.
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

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  minWidth: "12rem",
  maxWidth: "20rem",
  borderRight: "1px solid var(--color-border-primary, #e2e2e2)",
  overflowY: "auto",
};

const rowBaseStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  border: "none",
  borderBottom: "1px solid var(--color-border-secondary, #f0f0f0)",
  background: "transparent",
  color: "var(--color-text-primary, #1a1a1a)",
  font: "inherit",
  cursor: "pointer",
};

const rowSelectedStyle: CSSProperties = {
  ...rowBaseStyle,
  background: "var(--color-background-info, #eef4ff)",
  color: "var(--color-text-info, #0b57d0)",
};

/**
 * Master-detail list. Selection starts on the first row and moves with click or
 * ArrowUp/ArrowDown; the detail pane always reflects the selected row.
 */
export function ListDetail<T>({
  items,
  getKey,
  renderRow,
  renderDetail,
  emptyLabel,
  ariaLabel = "items",
}: ListDetailProps<T>) {
  const [selected, setSelected] = useState(0);

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

  if (items.length === 0) {
    return (
      <div data-testid="list-detail-empty" style={{ padding: "1rem", opacity: 0.7 }}>
        {emptyLabel ?? "Nothing to show."}
      </div>
    );
  }

  // Selection can dangle past the end if `items` shrank between renders; clamp on
  // read so the detail pane never indexes out of bounds.
  const activeIndex = Math.min(selected, items.length - 1);
  const activeItem = items[activeIndex];

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: "1rem" }}>
      <ul
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={listStyle}
      >
        {items.map((item, index) => {
          const isSelected = index === activeIndex;
          return (
            <li key={getKey(item, index)} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => setSelected(index)}
                style={isSelected ? rowSelectedStyle : rowBaseStyle}
              >
                {renderRow(item, isSelected)}
              </button>
            </li>
          );
        })}
      </ul>
      <div data-testid="list-detail-pane" style={{ flex: 1, minWidth: 0, padding: "0.25rem 0" }}>
        {renderDetail(activeItem)}
      </div>
    </div>
  );
}
