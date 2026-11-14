// shared/exams.ts: how many exams each section has, and how long « Nouveau » lasts.
import { describe, it, expect } from "vitest";
import { EXAMS, NEW_DAYS, isFresh, localDay } from "../shared/exams.ts";

describe("exams per section", () => {
  it("listening has 42 exams, reading 44 (scripts/bank-export.py checks the same numbers)", () => {
    expect(EXAMS).toEqual({ co: 42, ce: 44 });
  });
});

describe("« Nouveau »", () => {
  it("shows from the day it was added for 30 days, then never again", () => {
    expect(NEW_DAYS).toBe(30);
    expect(isFresh("2026-11-11", "2026-11-10")).toBe(false);
    expect(isFresh("2026-11-11", "2026-11-11")).toBe(true);
    expect(isFresh("2026-11-11", "2026-12-10")).toBe(true);
    expect(isFresh("2026-11-11", "2026-12-11")).toBe(false);
    expect(isFresh("2026-11-11", "2027-01-01")).toBe(false);
  });
  it("nothing added, nothing new", () => {
    expect(isFresh(null, "2026-11-11")).toBe(false);
    expect(isFresh(undefined, "2026-11-11")).toBe(false);
  });
  it("the device's own day, YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 10, 11, 23, 59))).toBe("2026-11-11");
    expect(localDay(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
});
