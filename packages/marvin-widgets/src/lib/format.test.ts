import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("truncates an ISO datetime to its date", () => {
    expect(formatDate("2026-07-09T12:34:56Z")).toBe("2026-07-09");
  });

  it("returns a date-only string unchanged", () => {
    expect(formatDate("2026-07-09")).toBe("2026-07-09");
  });

  it("returns garbage unchanged", () => {
    expect(formatDate("not a datetime")).toBe("not a datetime");
  });

  it("returns the empty string unchanged", () => {
    expect(formatDate("")).toBe("");
  });
});
