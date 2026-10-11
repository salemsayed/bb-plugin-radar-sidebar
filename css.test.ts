import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards over app.css.
 *
 * jsdom does not resolve the real cascade, so these assert on the stylesheet
 * text for classes of bug that are invisible to a render test.
 */
// The test sits beside app.css at the package root.
const css = readFileSync(
  resolve(import.meta.dirname ?? ".", "app.css"),
  "utf8",
);

/** Every `selector { body }` block, with comments stripped. */
function rules(source = css): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
}

describe("app.css", () => {
  it("keeps our stylesheet out of BB's rail and sidebar shell", () => {
    const selectors = rules().flatMap(rule => rule.selector.split(/,(?![^()]*\))/));
    expect(selectors.filter(selector => /\[data-sidebar=|\.group\.peer|\[data-testid=|\bhtml\b|data-radar-rail/.test(selector))).toEqual([]);
    expect(css).not.toContain(".radar-double-navigation");
  });

  it("lets a swiped-away row fold shut whatever its density", () => {
    // The compact and two-line rules set a min-height at the same specificity
    // and come later in the file, so only !important lets the fold win.
    const fold = rules().find((rule) =>
      rule.selector.includes('.radar-row[data-swipe-phase="fold"]'),
    );
    expect(fold?.body).toMatch(/min-height:\s*0\s*!important/);
    // The wait in useRowSwipe is the one place the duration is set.
    expect(fold?.body).toMatch(/height var\(--radar-swipe-fold,/);
  });

  it("keeps metadata and the owned title transparent to one-line layout", () => {
    for (const selector of [".radar-row-meta", ".radar-thread-title"]) {
      expect(rules().find((rule) => rule.selector === selector)?.body)
        .toMatch(/display:\s*contents/);
    }
  });

  it("clamps the whole title instead of the last SDK segment", () => {
    const title = rules().find((rule) =>
      rule.selector === ".radar-title-wrap .radar-thread-title",
    );
    expect(title?.body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rules().filter((rule) => /radar-title-wrap/.test(rule.selector) && /-webkit-line-clamp/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([".radar-title-wrap .radar-thread-title"]);
  });

  it("sizes wrapping titles from content and declares wrapping metadata once", () => {
    expect(rules().find((rule) => rule.selector === ".radar-title-wrap .radar-row-title-text")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    expect(rules().filter((rule) => rule.selector === ".radar-title-wrap .radar-row-meta"))
      .toHaveLength(1);
  });

  it("lifts two-line hover actions clear of the branch line and never hides them", () => {
    // The bar sits at the row's bottom in two-line mode. Unlifted, it lands
    // on the branch line and takes clicks meant for the PR badge. Hiding
    // actions per row is out too: under project grouping no row has a chip,
    // so that emptied the bar list-wide.
    const wrap = rules().filter((rule) => /radar-title-wrap/.test(rule.selector));
    expect(wrap.find((rule) => /:has\(\.radar-branch-line\)/.test(rule.selector))?.body)
      .toMatch(/--radar-actions-lift:\s*[1-9]\d*px/);
    expect(wrap.find((rule) => /\.radar-row-actions$/.test(rule.selector) && /bottom:/.test(rule.body))?.body)
      .toMatch(/var\(--radar-actions-lift\)/);
    expect(wrap
      .filter((rule) => /\.radar-action\b/.test(rule.selector) && /display:\s*none/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([]);
    expect(rules().filter((rule) => /radar-title-wrap.*:hover/.test(rule.selector)))
      .toEqual([]);
  });

  it("estimates unrendered two-line rows taller than one-line rows", () => {
    const estimate = (selector: RegExp) => Number(
      rules()
        .find((rule) => selector.test(rule.selector) && /contain-intrinsic-size/.test(rule.body))
        ?.body.match(/contain-intrinsic-size:\s*auto\s+(\d+)px/)?.[1],
    );
    expect(estimate(/^\.radar-title-wrap \.radar-row$/))
      .toBeGreaterThan(estimate(/^\.radar-row$/));
    expect(estimate(/^\.radar-title-wrap\.radar-density-compact \.radar-row,/))
      .toBeGreaterThan(estimate(/^\.radar-density-compact \.radar-row,/));
  });

  it("never resets the row margin with the shorthand", () => {
    // `margin: 0` also zeroes margin-left, which silently wipes the child
    // thread indent that .radar-row-child / .radar-row-deep own.
    const offenders = rules()
      .filter((rule) => /\.radar-row\b/.test(rule.selector))
      .filter((rule) => /(^|[;{\s])margin:\s*0\s*[;]?\s*$/.test(rule.body));

    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it("keeps the child indent defined", () => {
    const child = rules().find((rule) => rule.selector === ".radar-row-child");
    const deep = rules().find((rule) => rule.selector === ".radar-row-deep");
    expect(child?.body).toMatch(/margin-left:\s*16px/);
    expect(deep?.body).toMatch(/margin-left:\s*28px/);
  });

  it("keeps compact inline padding identical to comfortable", () => {
    // Compact must compress vertically only, or the tree guides drift off
    // the text they belong to.
    const main = rules().find((rule) =>
      /\.radar-density-compact \.radar-row-main/.test(rule.selector),
    );
    expect(main?.body).toMatch(/padding:\s*\d+px 8px/);
  });

  it("keeps badge-row titles readable when the row is squeezed", () => {
    // At phone widths a chip plus time plus badge left no room: the title
    // was the only shrinkable item, so it went to zero and the time
    // painted under the badge. Now the chip yields first, the title keeps
    // a floor, the time ellipsizes instead of overflowing, and the row
    // clips any pathological residue at the text edge.
    const project = rules()
      .filter((rule) => rule.selector === ".radar-row-project")
      .find((rule) => /flex:/.test(rule.body));
    expect(project?.body).toMatch(/flex:\s*0 1 auto/);
    expect(project?.body).toMatch(/min-width:\s*0/);
    expect(project?.body).toMatch(/text-overflow:\s*ellipsis/);
    expect(rules().find((rule) => rule.selector === ".radar-row-title-text")?.body)
      .toMatch(/min-width:\s*40px/);
    const time = rules().find((rule) => rule.selector === ".radar-row-time");
    expect(time?.body).toMatch(/flex:\s*0 1 auto/);
    expect(time?.body).toMatch(/white-space:\s*nowrap/);
    expect(time?.body).toMatch(/text-overflow:\s*ellipsis/);
    expect(rules().find((rule) => rule.selector === ".radar-row-title")?.body)
      .toMatch(/overflow:\s*clip/);
  });

  it("declares each row-affecting selector at most once", () => {
    const seen = new Map<string, number>();
    for (const rule of rules()) {
      if (!/\.radar-row-main|\.radar-row-extra/.test(rule.selector)) continue;
      seen.set(rule.selector, (seen.get(rule.selector) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1);
    // A later duplicate silently wins by source order — that is how the
    // padding regression came back during this fix.
    expect(duplicated.map(([selector]) => selector)).toEqual([]);
  });
  it("keeps one color per meaning and the left bar for state only", () => {
    const body = (selector: string) =>
      rules().filter((rule) => rule.selector === selector).map((rule) => rule.body).join("\n");
    expect(body(".radar-dot-running")).toMatch(/background:\s*var\(--primary\)/);
    expect(body(".radar-tone-running")).toMatch(/color:\s*var\(--primary\)/);
    // Plain unread is a bold title: no wash, no bar.
    expect(body(".radar-row-unread")).toBe("");
    expect(rules().filter((rule) => /\.radar-row-unread(?![\w-])/.test(rule.selector) && /background|box-shadow/.test(rule.body)))
      .toEqual([]);
    // Selection and split never draw on the left bar.
    expect(body(".radar-row-selected")).not.toMatch(/box-shadow/);
    expect(rules().filter((rule) => /^\.radar-row-split(\.|$)/.test(rule.selector))).toEqual([]);
    expect(css).not.toContain("data-radar-loud-unread");
  });

  it("never animates a row's height and keeps one loop per row", () => {
    const body = (selector: string) =>
      rules().filter((rule) => rule.selector === selector).map((rule) => rule.body).join("\n");
    expect(body(".radar-row-extra")).not.toMatch(/transition/);
    // Running text is static; only the spinner or one pulsing icon/dot moves.
    expect(body(".radar-tone-running")).not.toMatch(/animation/);
    expect(rules().filter((rule) => rule.selector === ".radar-spinner.radar-tone-running")).toEqual([]);
    expect(body(".radar-spinner")).toMatch(/animation:\s*radar-spin/);
    // Badges animate once when the container mounts, not per status change.
    expect(rules().filter((rule) => rule.selector.includes(".radar-row-badges > *"))).toEqual([]);
    expect(body(".radar-row-badges")).toMatch(/animation:\s*radar-badge-in/);
  });
});
