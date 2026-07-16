import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/preact";
import { ListDetail } from "./ListDetail";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

function renderList(items: Row[]) {
  return render(
    <ListDetail
      items={items}
      getKey={(item) => item.id}
      renderRow={(item) => <span>{item.name}</span>}
      renderDetail={(item) => <p>detail:{item.name}</p>}
      emptyLabel="nothing here"
    />,
  );
}

describe("ListDetail", () => {
  it("ListDetail renders rows and swaps detail on selection", () => {
    renderList(rows);

    // one row per item
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);

    // the first row is selected and its detail shows
    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByText("detail:Alpha")).toBeTruthy();
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    // selecting another row swaps the detail pane
    fireEvent.click(options[2]);
    expect(within(pane).getByText("detail:Gamma")).toBeTruthy();
    expect(screen.queryByText("detail:Alpha")).toBeNull();
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
  });

  it("moves the selection with ArrowDown/ArrowUp", () => {
    renderList(rows);
    const listbox = screen.getByRole("listbox");
    const pane = screen.getByTestId("list-detail-pane");

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(within(pane).getByText("detail:Beta")).toBeTruthy();
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(within(pane).getByText("detail:Alpha")).toBeTruthy();
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the last/first row with End/Home", () => {
    renderList(rows);
    const listbox = screen.getByRole("listbox");
    const pane = screen.getByTestId("list-detail-pane");

    fireEvent.keyDown(listbox, { key: "End" });
    expect(within(pane).getByText("detail:Gamma")).toBeTruthy();
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(listbox, { key: "Home" });
    expect(within(pane).getByText("detail:Alpha")).toBeTruthy();
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the listbox as the single tab stop (rows are tabindex -1)", () => {
    renderList(rows);
    expect(screen.getByRole("listbox").getAttribute("tabindex")).toBe("0");
    for (const option of screen.getAllByRole("option")) {
      expect(option.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("points aria-activedescendant at the selected option", () => {
    renderList(rows);
    const options = screen.getAllByRole("option");

    // every option carries a stable non-empty id
    for (const option of options) {
      expect(option.id).not.toBe("");
    }

    // initially the first option is the active descendant
    expect(screen.getByRole("listbox").getAttribute("aria-activedescendant")).toBe(options[0].id);

    // selection by click retargets it
    fireEvent.click(options[2]);
    expect(screen.getByRole("listbox").getAttribute("aria-activedescendant")).toBe(options[2].id);

    // selection by keyboard retargets it too
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Home" });
    expect(screen.getByRole("listbox").getAttribute("aria-activedescendant")).toBe(options[0].id);
  });

  it("renders the empty state for an empty list", () => {
    renderList([]);
    expect(screen.getByTestId("list-detail-empty").textContent).toContain("nothing here");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("themes the selection from tokens and keeps every row's bottom border", () => {
    renderList(rows);
    const options = screen.getAllByRole("option");

    // selection = accent tint + the 2px inset rail, inline so it beats :hover
    expect(options[0].style.background).toBe("var(--acbg)");
    expect(options[0].style.boxShadow).toBe("inset 2px 0 0 var(--ac)");

    // unselected rows carry NO inline style — class styling only — and no row
    // (including the LAST) overrides its bottom border away (design decision D)
    for (const option of options) {
      expect(option.className).toContain("mvld-row");
      expect(option.style.borderBottom).toBe("");
    }
    expect(options[1].style.background).toBe("");

    // the injected sheet exists once and carries the row/list rules
    const sheet = document.getElementById("mv-listdetail-styles");
    expect(sheet?.textContent).toContain("border-bottom:0.5px solid var(--bd)");
    expect(sheet?.textContent).toContain("padding:9px 12px");
    expect(sheet?.textContent).toContain("width:15.5rem");
    expect(sheet?.textContent).toContain("@media (max-width:640px)");
    expect(document.querySelectorAll("#mv-listdetail-styles")).toHaveLength(1);
  });
});
