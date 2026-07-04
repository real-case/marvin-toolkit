import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(within(pane).getByText("detail:Alpha")).toBeTruthy();
  });

  it("renders the empty state for an empty list", () => {
    renderList([]);
    expect(screen.getByTestId("list-detail-empty").textContent).toContain("nothing here");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
