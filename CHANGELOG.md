# Changelog

All notable changes to Radar Sidebar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.6.1 - 2026-10-11

### Changed

- Working drawer rows fit the drawer: the spinner or clock stays, the status word and model/thinking chips go, and each row keeps its title on one line with the project chip and the full time on one line below.
- Desktop hover shows a single ⋯ (More actions) instead of a strip of pin, rename and archive buttons that covered the row's text and took clicks meant for it. Those actions stay in the ⋯ menu, the context menu and swipes; touch layouts are unchanged.
- Went-live times survive a page reload: they are kept in `sessionStorage` (`radar-sidebar:went-live:v1`, at most 500), so a refresh no longer sorts every live thread as just started.

## 0.6.0 - 2026-10-11

### Removed

- The `loudUnread` setting: unread rows no longer have a loud treatment to turn off.
- Remove the in-list Crew view (no longer reachable), its job feed and roster helpers, the unused Jev ask classifier and answer resolver, and the frozen "Reply seen, not confirmed" marker those left behind.
- Retire the Crew Bot coordinator: its work board, outbox, shadow pilot, agent tools and `bb crew` commands. ChatGPT coordinates the bots through the BB Bots connection. Existing `crew_*` tables stay in the plugin database, unused.

### Changed

- One colour per meaning. Blue = running (the spinner, one pulsing icon for background agents, commands, workflows, goals and plan mode, and the working-draft and live rollup dots), green = done (static check and DONE), amber = needs you, red = failed, muted = queued (a clock and a muted QUEUED, with no glow). A tinted row with a left bar means act on it: only needs-you and failed rows are tinted.
- Plain unread rows lose the green wash and left bar and keep a bold title plus the unread pip. A row showing DONE shows no extra pip.
- The 3px left bar carries state only. Selection is a tint plus the checkbox; a row open in a split pane gets a thin mark on its right edge instead of a second stripe.
- Rows never change height when their state changes: the adaptive fold is decided when a row appears (and again only when the setting or density changes), and no longer animates.
- Rows don't move under the pointer or a finger. While the list is hovered, touched, or for 600ms after a touch or scroll ends, rows keep their order and update in place, and new threads join the end of their group. The new order lands after about 400ms without pointer movement. Dropping a thread onto a section still moves it at once.
- A live thread sorts by when it went live instead of the current time, so it no longer keeps floating to the top.
- Less motion: the badge strip pops in once when a row appears instead of on every status change; status words never blink; each row has at most one loop (spinner, icon pulse, or the needs-you/failed glow).
- `adaptiveCollapse` now defaults to off, keeping every row a fixed height.

- Redesign each bot's Attention panel: tone-coloured cards with kind, age and due chips; one primary action per card; bot fields shown as lines; long updates clamped behind Show more (a clamped update is never auto-marked seen); Mark all seen; folded Later (soonest first, next date), With the bot and paged compact History.

- Defer offscreen row contents and inactive More menus, retaining lightweight links, measured heights, keyboard navigation and native bulk actions. Suspend offscreen model requests and gestures, and rebind swipes when a deferred row becomes visible.

- Use BB's shared thread-action menus on desktop and mobile, including actions contributed by other plugins such as per-thread notifications. Replace the retired sidebar action hook with public navigation and thread APIs; retain BB's archive/delete confirmation and Undo flows for shortcuts, swipes and bulk actions. Require SDK 0.6.37.

- Rebuild Crew as a read-only overview: pending approvals and the Needs You list, then one card per bot with state, machine, context ring, live or blocked workers (hidden included), latest reply and ChatGPT's instructions today. Old failures are counted, not listed. The header shows ChatGPT's connection and alert-watch deadline.
- The Crew rail icon shows a count of what needs Salem, or a dot while bots work.
- The bot row starts with **All** instead of a house icon, so it is not mistaken for BB's rail Home.
- The working spinner no longer freezes while BB is busy (for example rendering or streaming a long Bricks thread): it now rotates an HTML wrapper on the compositor instead of animating the SVG on the main thread.
- Visual pass on bot faces and status: faces now fit their frame, so rings no longer cut through them and badges sit in the corner instead of on an eye. Each state has its own expression (calm, busy, asking, crossed out, asleep). "?" badges are bright amber with dark ink so they read on orange and yellow bots, and queued and handover rings are easier to tell from working. Bricks loses the bars that read as teeth; ERBareeq's bolt moves clear of its eyes. Crew cards wear the same expressions, and shortcuts are a little larger on desktop while all six still fit a phone drawer.
- A bot's ask comes from its open decision or urgent Needs You item instead of Crew requests.

- Use BB's native navigation rail. Move bot shortcuts into the thread-list header, preserving bot scopes, visibility, worker filtering and hover details. Remove retired SDK navigation APIs and shell layout overrides; update the development SDK to match the installed host.
- Give Crew a dedicated group icon in BB's native desktop and mobile rail, and keep its destination out of the bot shortcut bar.
- Light unread bot rail tiles blue independently of activity or attention. Use neutral selection, clear !/? badges and distinct activity rings; context and worker counts move into details.
- Keep idle faces plain; distinguish failed/input badges, running/queued/handover rings, unread lights and unavailable outlines. Every state has an accessible label, description and relevant hover-card action. Separate queued work, handover and unavailable coordinators from working and idle; keep failures and questions visible after reading.
- Reconcile Radar-captured Crew decisions after a newer human answer and coordinator acknowledgment, using Jev with a 0.8 threshold over the conversation and preceding questions. Retain delayed answers and acknowledgments, exclude nested worker output, and refresh old negative verdicts. Unrelated replies, unresolved questions, manual reminders and automation asks stay open. Preserve concurrent Snooze/Done changes and Undo on the same reply; retry failures and history limits after five minutes.
- Rebuild Crew as an ask inbox, a stable bot roster and flat recent history. Complete questions open their source, check circles mark Done, and clocks open Snooze. Preserve in-place six-second Undo, collapse snoozed asks, expose due/overdue and reply-seen markers, and offer inline Retry. Context warnings and full hover details remain available; visual status text no longer pulses. Show/hide bots through an on-demand visibility control.

- Fold the thread list header into one row: the search field and a view
  options button. Status chips, smart views, Active / Archived / All,
  grouping, density and collapse-all open in a panel under it. While a
  filter narrows the list, a removable pill per filter shows under the
  search. Density is hidden on touch viewports, which are always compact.
- Show a bot or crew scope as a removable pill under the list header. A bot
  pill's name opens its coordinator; its X clears the scope. BB owns New
  thread and the back/forward controls. Time groups lose their clock icon,
  and touch lists tighten the space around group headers.
- Hover the Working drawer's header for a peek at every running thread:
  what it last said and did, its phase, steps, todo progress, run time and
  context use, with flags for stalls, failing commands, a nearly full
  context or a waiting question. Click one to open it. Digests are built on
  the server, so the card stays light over a remote connection.

## 0.5.2 - 2026-10-04

### Fixed

- Keep BB's sidebar toggle and the updates chips inside the navigation rail.
  The desktop toggle was offset past the rail to clear the traffic lights,
  and the updates chips wrapped out of the footer column.
- Give the updates chips a taller cell in the narrow rail. The project
  tiles keep their size. The destination list scrolls in a shorter stack
  so the footer can use the height it needs. The same separator that sits
  above the project icons also sits above Show labels and Customize.
- Keep the thread list responsive while agents run. Each sidebar update
  re-rendered every row, even when only one thread had changed. Now only
  the changed row re-renders. The minute clock now refreshes only rows
  whose time label moved.
- Unmount rows in a folded group or family once it finishes closing.
  Folded threads no longer cost rendering work or pull-request lookups.
- Stop the sidebar toggle alignment from 0.5.1 slowing down all of BB.
  Its `body:has()` rules made every DOM change restyle the whole page,
  even with the rail off. That covered each streamed chunk and each
  tooltip or menu opening. The rail now renders its overrides for BB's
  sidebar as `<style>` elements in its own markup, applied only while it
  is mounted. It no longer uses `:has()` and never writes to BB's
  elements. Computed styles are unchanged.
  In a 20,000-element benchmark, a chat update drops from about 6.8ms to
  0.35ms, and a tooltip from about 5.8ms to 2µs.
- Lighten the navigation rail. Its height reserve is now a rule scoped to
  the sidebar rather than a custom property on the page root, which cost
  a full-page restyle on every resize frame. Thread updates no longer re-render its destinations
  and project tiles unless something they show changed. Scroll updates
  for its scroll thumb run once per frame.

## 0.5.1 - 2026-10-04

### Fixed

- Align BB's sidebar toggle with the navigation rail's icon column in narrow,
  labelled and mobile layouts. The override releases when the rail is off
  or the desktop sidebar is collapsed.

## 0.5.0 - 2026-10-04

### Added

- Optional **Navigation rail** (`railNav`, default `false`) beside the Radar
  thread list on desktop and mobile, retaining the published plugin identity
  and the existing navigation above the list when off.
- Project monogram filters, Home to show every project, desktop tooltips with
  shortcuts and tallies, keyboard traversal, and destination arrangement menus.
- Experimental **Labelled rail** (`wideRail`, default `false`), requiring
  Navigation rail and a recognised host shell. Sidebar expansion derives
  from the rail widths and preserves the thread list's room.
- Scoped host footer and Customize layouts that release on deselection,
  setting changes, Settings, and offcanvas collapse; reduced motion and
  mobile safe-area support.
- Narrow-list status chips fold at 284px, retaining accessible labels.
- CSS cascade guards and project-scope persistence/lifecycle regression tests.

### Fixed

- Home clears the project filter without creating a thread; New thread keeps
  BB's original action and does not clear the selected project.
- Turning the rail off restores every project while remembering the filter
  for later; an independently selected list offers its own clear control.
- Project tiles sort by real activity rather than read timestamps, with live
  work ahead of idle projects.
- More focuses its first enabled destination so keyboard traversal works
  immediately, in both navigation layouts.
- Entering a compact viewport clears visible and pending desktop tooltips.

## 0.4.1 - 2026-10-01

### Changed

- Large sidebars do less repeated work: date formatting and family
  traversal are cached, and requests and gesture handlers inside folds
  pause while hidden. Fold state and summaries stay reactive.

### Fixed

- The touch nav lays its icons out as a row across the top instead of a
  tall centered column, so the thread list starts near the top on phones.
  Icons wrap to a second row only when more arrive than fit.
- One-line thread titles no longer collapse to zero width on narrow rows
  with a status badge: the project chip shrinks first behind its ellipsis,
  the title keeps a 40px floor, and the time shrinks with an ellipsis
  instead of sliding under the badge.

## 0.4.0 - 2026-10-01

### Added

- **Swipe actions** (`swipeActions`, default `true`): swipe a thread row left
  or right to act on it, with one finger on a touch screen or two fingers on
  a trackpad (a Mac, or an iPad with a Magic Keyboard). Each side is
  configurable (`swipeRight`, default mark read / unread; `swipeLeft`,
  default archive / unarchive) from: mark read / unread, pin / unpin,
  archive / unarchive, open in split, rename, more actions, delete
  (host-confirmed), or nothing.
  - The row tracks the input, a colored pill grows from the edge with its
    icon growing alongside, and the icon pops when the swipe arms (a third
    of the row by touch, over half by trackpad), with a short haptic tick
    where supported. On release a spring carries the input's speed home, so
    a flick flows into the settle; a swipe that rests before release carries
    no speed. The pill keeps the label of what was done while it closes.
  - Archiving (or unarchiving from the Archived tab) slides the row away and
    folds its space before the host acts; on the All tab the row stays and
    springs back, and so does a thread with replies, whose archive the host
    confirms first.
  - Trackpads report no lift-off, so a trackpad swipe stopped short of
    arming rests open with its action as a button, as in Mail on a Mac:
    click it to act; press elsewhere, scroll or press Escape to close; move
    again to carry on. One row stays open at a time. A swipe keeps following
    after the row slides out from under the cursor, and the momentum tail
    after a release is swallowed.
  - Vertical movement stays a scroll, the host drawer does not react to a
    row swipe, releasing a swipe never opens the thread, and a mouse's
    clicks, drags and Shift+wheel are unaffected. A sideways wheel step of a
    whole notch (a tilt wheel) is left to scroll too: a trackpad eases in
    with small steps, and only that starts a swipe.
  - Opening a row by trackpad closes any other row left open, and Escape
    closes an open row without also clearing the search behind it.

### Fixed

- Jump shortcuts (⌘/Ctrl+1–9) skip rows hidden in a folded family or
  collapsed group, so the numbers follow the rows on screen. A search or
  status filter that forces a fold open numbers its rows again.

## 0.3.0 - 2026-09-30

### Added

- **Two-line titles** (`twoLineTitles`, default `false`): long thread titles,
  including mentions, wrap before truncating. Project chip and time stay
  beside short titles when they fit, or wrap below aligned with the text.
  Applies in both densities. Hover actions move to the row's last line of
  plain text, off a wrapped title and clear of the PR badge. Rows use taller
  offscreen height estimates, and the row-height settings (`defaultDensity`,
  `twoLineTitles`) are remembered per client so the first paint uses them
  before settings finish loading.
- Tests use jsdom storage explicitly so Node 26's native `localStorage`
  does not cause preference and sidebar tests to fail.

## 0.2.1 - 2026-09-29

### Fixed

- Folding groups or families clears hidden selections and keyboard targets,
  and restores focus when the focused row disappears.
- Group status prioritizes failures and input waits over running work, counts
  each descendant, and excludes queued or blocked work from running counts.
- Folded-family status describes only hidden descendants, excluding the parent.
- Mounted rows react to changes in celebration, hover-card and adaptive-collapse
  settings, and reuse unchanged provider records to preserve row memoization.
- Navigation follows BB's live order and visibility hook and delegates saves to
  host actions, removing duplicate preference fetches, races and merge logic.
- Section grip drags move the selected threads together and report partial
  failures. Keyboard section dragging works and exposes its grip to assistive
  technology while project sorting retains its own keyboard behavior.
- Archive shortcuts and bulk actions leave completion feedback to BB, which
  may require confirmation before archiving a family.
- Opening a row menu closes its hover preview and cancels pending previews.
- Time buckets use local calendar boundaries across daylight-saving changes.

## 0.2.0 - 2026-09-29

### Added

- Create sections directly in Radar's section view with **New section**:
  inline naming, keyboard cancellation, pending-state protection and retryable
  error feedback through BB's section API.

### Changed

- Update to BB 0.44 navigation API: use host sidebar navigation hooks, split
  drag handles, and support dedicated skills panel actions.

### Fixed

- Keyboard shortcuts no longer take over the rest of BB. They stay out of
  text fields, open dialogs and menus and controls outside the list, ignore keys another handler already
  handled or that carry ⌘/Ctrl/Alt, and no longer swallow arrow keys when
  the list is empty. Enter keeps its native behaviour on links and buttons;
  Space folds a focused thread family without taking over nested buttons.
- Arrow navigation moves DOM focus with the highlight, so archive, pin and
  selection shortcuts act on the displayed target rather than a stale row.
- Mark family read includes the selected child and its descendants, not just
  its root and siblings.
- Text and status filters reveal matches inside collapsed groups without
  overwriting saved fold preferences.
- Archived pagination stays available when loaded threads do not match the
  active filters.
- Empty sections remain visible as drag-and-drop destinations, including
  when there are no threads or the current filters match nothing.
- Execution details refresh for new runs and newer activity, including rows
  returning from a filter, without stale requests overwriting the cache.
- Completion celebrations expire despite intervening thread updates and
  overlapping completions; pending timers are cleared on unmount.
- The Pinned smart view now filters to pinned threads instead of just
  resetting the filters, and "Save view" only appears when a filter is active.
- Selection is pruned to rows the list still shows, so bulk actions can no
  longer hit threads a filter has hidden. X toggles selection from the
  keyboard, and dragging a selected row now carries the whole selection.
- Bulk pin, bulk mark-read and the pin shortcut report failures instead of
  announcing success, and pin errors from the row and peek card are shown.
- Saved smart views are validated on load, so a corrupt entry no longer
  crashes the list.
- The filtered-count label no longer includes hidden helper threads.
- The preference migration is retried on the next launch when a key could not
  be moved, instead of being marked done.
- Menus: Home focuses the first item and End the last; the More popover no
  longer uses invalid menu/list roles.
- Renaming a thread is no longer overwritten when its title changes
  underneath you.
- Threads whose parents form a cycle no longer disappear from the list.
- Thread rows skip re-rendering when nothing they show changed, and the
  filter box no longer blocks typing on large lists.
- Removed about 1,600 lines of unused UI code and the unused `zod` and
  `@radix-ui/react-checkbox` dependencies.
- BB now shows the radar icon for the plugin. `bb.branding.icon` named an icon
  BB's own set does not have, so BB fell back to its default; it now points
  at `assets/icon.svg`.

## 0.1.0 - 2026-09-28

### Added

- Activity-grouped thread list: Today / Yesterday / Previous 7 days / Previous
  30 days / Older, keyed off real activity rather than last-read time, so
  opening a thread never floats it to Today.
- Group by project or by section, with sticky headers, expand/collapse all,
  and drag-to-reorder projects.
- Nested thread families: indent guides, gutter folding, and a folded summary
  that rolls up hidden counts, unread state and the loudest hidden status.
- Attention system that separates working, needs-you, failed and
  finished-unread by icon, status word, wash, accent bar and motion; a
  one-time check pop when a thread finishes.
- Per-row provider icon, model and thinking chips (shown only while a thread
  is in flight), pull-request badges, and click-to-copy branches.
- Hover peek card with the initial goal, branch, PR and a stacked
  context-window meter with an auto-compaction marker.
- Smart views: save the current query, status filter and lifecycle as a named
  one-click preset.
- Status filter chips (all / live / waiting / unread), multi-select with bulk
  archive, pin and mark-read, full keyboard traversal, and comfortable or
  compact density.
- Navigation that follows BB's own server-synced sidebar arrangement, so
  arranging destinations in either surface carries over.
- Six settings: five that turn down the louder visuals, and a default row
  density.
- A one-time migration of preferences from the `codex-sidebar:` era.
