import { describe, expect, it } from "vitest";

import { isValidTheme } from "../ThemeProvider";

describe("theme validation", () => {
  it("recognizes valid themes", () => {
    expect(isValidTheme("light")).toBe(true);
    expect(isValidTheme("dark")).toBe(true);
    expect(isValidTheme("system")).toBe(true);
  });

  it("rejects invalid themes, wrong casing, and non-string types", () => {
    expect(isValidTheme("Light")).toBe(false);
    expect(isValidTheme("DARK")).toBe(false);
    expect(isValidTheme("dim")).toBe(false);
    expect(isValidTheme("neon")).toBe(false);
    expect(isValidTheme("")).toBe(false);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
    expect(isValidTheme(123)).toBe(false);
    expect(isValidTheme({})).toBe(false);
    expect(isValidTheme(["light"])).toBe(false);
  });
});
