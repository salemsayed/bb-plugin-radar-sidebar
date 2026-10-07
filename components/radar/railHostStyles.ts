/**
 * How the navigation rail restyles BB's own sidebar while it is mounted: the
 * gutter beside the rail, BB's header, footer and Customize editor, the wider
 * panel in labelled mode, and BB's sidebar toggle.
 *
 * RadarRailNavigation renders these as <style> elements in its own markup,
 * so they apply exactly while the rail is mounted and nothing is written to
 * BB's elements. Disabling the rail, switching providers or BB hiding the
 * sidebar body for Settings unmounts it and releases every override. Two
 * earlier designs each cost something: `:has()` anchored on body or the
 * sidebar made the browser restyle the page (or sidebar) on every DOM change
 * in BB, and data attributes stamped on BB's elements were fast but edited
 * host DOM.
 *
 * Blocks keep the cascade order they had in app.css. A block with a state
 * applies only in that state.
 */

export interface RailHostState {
  /** The labelled rail. */
  wide: boolean;
  /** BB's compact viewport: the rail in the mobile drawer. */
  compact: boolean;
}

const BLOCKS: readonly (readonly [keyof RailHostState | null, string])[] = [
  [null, `
/* Widths are shared by the rail, host gutter and host panel expansion. */
:is(html, .group.peer, [data-sidebar="sidebar"]) {
  --radar-rail-narrow: 60px;
  --radar-rail-mobile: 56px;
  --radar-rail-wide: 168px;
  --radar-rail-width: var(--radar-rail-narrow);
}
`],
  ["wide", `
:is(.group.peer, [data-sidebar="sidebar"]) {
  --radar-rail-width: var(--radar-rail-wide);
}
`],
  [null, `
@media (min-width: 768px) {
  /* BB's toggle is a fixed control outside the sidebar. On desktop macOS
     it is offset 84px to clear the traffic lights, which lands it in the
     thread column. Center it on the rail's icon column, under the lights,
     only while that sidebar is expanded. The toggle is a later sibling of
     the sidebar's .group.peer, so a sibling selector reads BB's own state. */
  div.group.peer[data-state="expanded"] ~ :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    left: 0;
    width: calc(var(--radar-rail-narrow) - 1px);
    padding-left: 0;
    justify-content: center;
  }
  div.group.peer[data-state="expanded"] ~ [data-testid="app-desktop-sidebar-trigger"] {
    top: 22px;
    height: fit-content;
  }
}
`],
  ["wide", `
@media (min-width: 768px) {
  /* Labelled buttons place their icons 30px from the rail's left edge. */
  div.group.peer[data-state="expanded"] ~ :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    width: var(--radar-rail-narrow);
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] {
    position: relative;
    padding-inline-start: var(--radar-rail-width);
  }
  /* BB's header row (sidebar trigger, history arrows) stays clickable
     above the rail surface that now runs behind it. */
  [data-sidebar="sidebar"] > div:first-child {
    position: relative;
    z-index: 1;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] {
    position: absolute;
    inset: auto auto 0 0;
    z-index: 2;
    /* Keep BB's horizontal overflow calculation at its original width.
       Only the 42px controls paint and receive input in the 60px rail. */
    width: calc(100% - var(--radar-rail-width));
    padding: 8px 9px 12px;
    pointer-events: none;
    isolation: isolate;
    background: transparent;
  }
  /* The destination list scrolls. --radar-rail-reserve (see
     railHostValuesCss) is the height it may keep; the host footer (updates, settings) gets the rest, and never
     less than two controls. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] > [data-sidebar="menu"] {
    max-height: max(
      92px,
      calc(var(--bb-shell-height, 100dvh) - var(--radar-rail-reserve, 290px) - 20px)
    );
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    overscroll-behavior: contain;
  }
  /* Host footer disclosures open beside the rail, keeping their real
     controls, focus handling and collapse action in a readable panel. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] > section[aria-label] {
    position: absolute;
    inset: auto auto 0 64px;
    z-index: 3;
    width: min(320px, calc(100vw - 80px));
    pointer-events: auto;
    background: var(--sidebar, var(--background));
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"]::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    z-index: -1;
    width: var(--radar-rail-width, 60px);
    border-inline-end: 1px solid var(--border);
    background: var(--sidebar, var(--background));
    /* Slides with the rail above it, so the column reads as one surface. */
    transition: width 200ms linear;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-overflow-fade] {
    display: none;
  }
  /* BB's footer menu is a wrap-reverse row: a flex spacer pushes the
     updates chips to the far side, and wrap-reverse then packs that line
     on the right, outside the rail. One column, no spacer, keeps every
     footer control — including the updates icons — on the rail. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu"] {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: flex-start;
    align-content: flex-start;
    gap: 6px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] > [data-sidebar="menu"] > li[aria-hidden="true"] {
    display: none;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] {
    flex: none;
    flex-direction: column;
    max-width: 100%;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"]:has(> [data-sidebar="menu"]) {
    width: 100%;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] a,
  [data-sidebar="sidebar"] > [data-sidebar="footer"] button {
    pointer-events: auto;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] {
    width: 42px;
    height: 42px;
    border-radius: 12px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] [data-icon-root] {
    width: 20px;
    height: 20px;
  }
  /* The host's "updates available" pill is a rounded-full row of a tiny
     arrow plus provider logos. In the rail it keeps the arrow on top and
     lets the logos wrap underneath, taller than the other footer controls. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) {
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    width: 46px;
    height: auto;
    min-height: 56px;
    padding: 6px 3px;
    overflow: hidden;
    border: 0;
    border-radius: 12px;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    color: var(--primary);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]):hover {
    background: color-mix(in srgb, var(--primary) 18%, transparent);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) > svg {
    width: 18px;
    height: 18px;
    color: inherit;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) > span {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
    max-width: 100%;
    line-height: 0;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) [data-provider-icon] {
    width: 14px;
    height: 14px;
  }
}
`],
  [null, `
@media (min-width: 768px) and (max-height: 540px) {
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] {
    height: 32px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu"] {
    gap: 4px;
  }
}
`],
  [null, `
@container radar-thread-list (max-width: 300px) {
  /* Preserve title space when the rail shares a narrow host sidebar. */
  [data-sidebar="sidebar"] .radar-status-word,
  [data-sidebar="sidebar"] .radar-row-project {
    display: none;
  }
}
`],
  [null, `
[data-sidebar="sidebar"] .radar-status-chips {
  flex-wrap: wrap;
  overflow: visible;
}
`],
  [null, `
/* BB's top reserve row only holds the back/forward pair, which the rail
   drops; the list header takes the top of the column instead. BB's toggle
   is a fixed overlay above the rail, so nothing else lives there. */
[data-sidebar="sidebar"] [data-testid="app-sidebar-top-reserve-row"] { display: none; }
`],
  [null, `
[data-sidebar="sidebar"] > [data-sidebar="footer"]::before {
  background: color-mix(in srgb, var(--sidebar, var(--background)) 94%, var(--foreground));
}
`],
  ["wide", `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] { padding-inline-start: var(--radar-rail-width); }
  /* Grow the whole sidebar by the extra rail width so the thread list keeps
     its room. Targets the host's --sidebar-width wrappers (gap + fixed
     panel); both animate with the host's own 200ms width transition. */
  /* Respect BB's offcanvas collapse: its gap goes to zero and its panel
     returns to the host width, which matches the host's offscreen offset. */
  .group.peer[data-state="expanded"] > [data-sidebar="gap"],
  .group.peer[data-state="expanded"] > [data-sidebar="panel"] {
    width: calc(var(--sidebar-width) + var(--radar-rail-wide) - var(--radar-rail-narrow)) !important;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"]::before { width: var(--radar-rail-width); }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] > section[aria-label] { left: calc(var(--radar-rail-width) + 4px); }
}
`],
  [null, `
@media (min-width: 768px) {
  /* Same curve and duration as BB's own sidebar width transition, so the
     gutter, the rail and the host panel all move as one. */
  [data-sidebar="sidebar"] { transition: padding-inline-start 200ms linear; }
}
`],
  ["wide", `
[data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] > .sr-only,
[data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"])::after,
[data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) > span {
  animation: radar-rail-label-in 140ms ease-out 140ms both;
}
[data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"]::before,
[data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"])::before {
  animation: radar-rail-label-in 200ms linear both;
}
`],
  [null, `
@media (prefers-reduced-motion: reduce) {
  [data-sidebar="sidebar"] > [data-sidebar="footer"]::before,
  [data-sidebar="sidebar"] { transition: none; }
}
`],
  ["wide", `
@media (prefers-reduced-motion: reduce) {
  [data-sidebar="sidebar"] > [data-sidebar="footer"] * { animation: none !important; }
}
`],
  ["wide", `
@media (min-width: 768px) {
  /* Wide mode: BB's footer controls grow into labelled rows too. BB decides
     how many footer actions fit by summing their widths, so every control
     keeps its 42px box; the row look is painted out of it: a ::before
     extends the hover surface to the rail's width and the host's own
     sr-only label is placed beside the icon. Absolutely positioned
     descendants still hit-test to the button, so the whole row clicks. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] {
    overflow: visible;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"],
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) {
    position: relative;
    isolation: isolate;
    width: 42px;
    height: 42px;
    min-height: 0;
    justify-content: flex-start;
    flex-direction: row;
    gap: 0;
    padding: 0 0 0 11px;
    border-radius: 12px;
    overflow: visible;
    background: transparent !important;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"]::before,
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"])::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    z-index: -1;
    width: 152px;
    border-radius: 12px;
    transition: background-color 120ms ease;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"]:hover::before,
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"][data-state="open"]::before {
    background: color-mix(in srgb, var(--sidebar, var(--background)) 70%, var(--foreground) 10%);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] [data-icon-root] {
    width: 20px;
    height: 20px;
    flex: none;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-button"] > .sr-only {
    position: absolute;
    left: 41px;
    top: 50%;
    transform: translateY(-50%);
    width: 101px;
    height: auto;
    margin: 0;
    padding: 0;
    overflow: hidden;
    clip: auto;
    clip-path: none;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 13px;
    font-weight: 500;
    color: inherit;
  }
  /* Updates pill: tinted row, "Updates" beside the arrow, logos at the end. */
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"])::before {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]):hover::before {
    background: color-mix(in srgb, var(--primary) 18%, transparent);
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) > svg {
    width: 18px;
    height: 18px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"])::after {
    content: "Updates";
    position: absolute;
    left: 41px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) > span {
    position: absolute;
    right: calc(42px - 152px + 10px);
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 3px;
  }
  [data-sidebar="sidebar"] > [data-sidebar="footer"] [data-sidebar="menu-item"] > a:not([data-sidebar="menu-button"]) [data-provider-icon] {
    width: 12px;
    height: 12px;
  }
}
`],
  [null, `
@media (min-width: 768px) {
  @layer base {
    /* ---- BB's Customize editor beside the rail. ----
       Opening Customize makes BB hide this provider's wrapper and render its
       arrangement editor in the navigation region, which for a single-column
       nav is "in place". Here that region is the top of the thread column, so
       the editor shoved the list down and the rail blinked out. Keep the rail
       visible (so the user can see what they are arranging) and float the
       editor as a panel beside it, like the footer disclosures. */
    /* BB's preflight hides [hidden] with an !important rule inside
       @layer base; important declarations in a layer outrank unlayered
       ones, so this joins that same layer (names are document-global) and
       wins there on specificity. */
    [data-sidebar="sidebar"] > nav > [hidden]:has(> [data-bb-plugin-root]) {
      display: contents !important;
    }
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] {
    position: absolute;
    top: 56px;
    left: 68px;
    z-index: 4;
    width: min(300px, calc(100vw - 92px));
    padding: 0;
    pointer-events: auto;
  }
}
`],
  ["wide", `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] {
    left: calc(var(--radar-rail-width) + 8px);
  }
}
`],
  [null, `
@media (min-width: 768px) {
  [data-sidebar="sidebar"] [data-sidebar-navigation-customize-mode="true"] > div {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--popover, var(--sidebar, var(--background)));
    box-shadow:
      0 12px 32px rgb(0 0 0 / 0.18),
      0 2px 6px rgb(0 0 0 / 0.08);
  }
  /* More, which holds Customize, reads as "open" while editing. */
  [data-sidebar="sidebar"]:has([data-sidebar-navigation-customize-mode="true"]) .radar-double-rail button[aria-label^="More navigation"] {
    background: color-mix(in srgb, var(--primary) 12%, transparent);
    color: var(--primary);
  }
}
`],
  ["compact", `
@media (max-width: 767px) {
  :is([data-testid="app-sidebar-trigger-overlay"], [data-testid="app-desktop-sidebar-trigger"]) {
    width: calc(var(--radar-rail-mobile) - 1px);
    padding-left: 0;
    justify-content: center;
  }
  [data-sidebar="sidebar"]:not(:has([data-sidebar-navigation-customize-mode="true"])) {
    position: relative;
    --radar-rail-width: var(--radar-rail-mobile);
    padding-inline-start: var(--radar-rail-width);
  }
  /* BB's mobile Customize is a full-drawer screen that replaces the
     navigation (the drawer wraps it differently from desktop), so the
     gutter steps aside while it is open rather than floating a panel. */
}
`],
];

export function railHostCss(state: RailHostState): string {
  return BLOCKS.filter(([when]) => when === null || state[when])
    .map(([, css]) => css)
    .join("");
}

export interface RailHostValues {
  /** Height the rail's destinations keep above BB's footer, in px. */
  reserve: number | null;
  /** BB's footer scroll thumb, in px from the footer's top; null when it fits. */
  footerThumb: { top: number; height: number } | null;
  wide: boolean;
}

/**
 * The measured values, for a second small <style> the rail rewrites as they
 * change (resize and scroll frames), so the larger sheet above only changes
 * with the rail's state.
 */
export function railHostValuesCss({ reserve, footerThumb, wide }: RailHostValues): string {
  let css = "";
  if (reserve !== null) {
    css += `[data-sidebar="sidebar"] { --radar-rail-reserve: ${reserve}px; }\n`;
  }
  if (footerThumb !== null) {
    css += `
[data-sidebar="sidebar"] > [data-sidebar="footer"] {
  --radar-scroll-top: ${footerThumb.top}px;
  --radar-scroll-height: ${footerThumb.height}px;
}
@media (min-width: 768px) {
  [data-sidebar="sidebar"] > [data-sidebar="footer"]::after {
    content: "";
    position: absolute;
    left: 55px;
    top: var(--radar-scroll-top);
    height: var(--radar-scroll-height);
    width: 3px;
    border-radius: 9999px;
    background: var(--muted-foreground);
    opacity: 0.65;
    pointer-events: none;
  }${wide ? `
  [data-sidebar="sidebar"] > [data-sidebar="footer"]::after { left: calc(var(--radar-rail-width) - 5px); }` : ""}
}
`;
  }
  return css;
}
