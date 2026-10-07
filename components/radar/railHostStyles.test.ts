import { describe, expect, it } from "vitest";
import { railHostCss, railHostValuesCss } from "./railHostStyles";

const base = { wide: false, compact: false };

describe("railHostCss", () => {
  it("adds each state's rules only in that state, after the shared ones", () => {
    const narrow = railHostCss(base);
    expect(narrow).toContain("padding-inline-start: var(--radar-rail-width)");
    expect(narrow).not.toContain("--radar-rail-width: var(--radar-rail-wide)");
    expect(narrow).not.toContain(".radar-list-scope");
    expect(narrow).not.toContain("--radar-rail-mobile);");

    const wide = railHostCss({ ...base, wide: true });
    expect(wide).toContain("--radar-rail-width: var(--radar-rail-wide)");
    // A state's rules override the shared ones, so they must come later.
    expect(wide.indexOf("--radar-rail-width: var(--radar-rail-wide)"))
      .toBeGreaterThan(wide.indexOf("--radar-rail-width: var(--radar-rail-narrow)"));

    expect(railHostCss({ ...base, compact: true })).toContain("--radar-rail-width: var(--radar-rail-mobile)");
  });

  it("drops BB's back/forward row in every state", () => {
    for (const wide of [false, true]) for (const compact of [false, true]) {
      expect(railHostCss({ wide, compact })).toContain('[data-sidebar="sidebar"] [data-testid="app-sidebar-top-reserve-row"] { display: none; }');
    }
  });

  it("aligns BB's toggle from its own expanded state, not a copy of it", () => {
    expect(railHostCss(base)).toContain('div.group.peer[data-state="expanded"] ~ [data-testid="app-desktop-sidebar-trigger"]');
  });
});

describe("railHostValuesCss", () => {
  it("writes the reserve and BB's footer thumb as sidebar-scoped rules", () => {
    expect(railHostValuesCss({ reserve: null, footerThumb: null, wide: false })).toBe("");
    const css = railHostValuesCss({ reserve: 480, footerThumb: { top: 12, height: 40 }, wide: false });
    expect(css).toContain('[data-sidebar="sidebar"] { --radar-rail-reserve: 480px; }');
    expect(css).toMatch(/--radar-scroll-top: 12px;\s*--radar-scroll-height: 40px;/);
    expect(css).toContain("left: 55px;");
    expect(css).not.toContain("calc(var(--radar-rail-width) - 5px)");
    expect(railHostValuesCss({ reserve: null, footerThumb: { top: 0, height: 18 }, wide: true }))
      .toContain("left: calc(var(--radar-rail-width) - 5px)");
  });
});
