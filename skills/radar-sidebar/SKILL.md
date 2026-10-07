---
name: radar-sidebar
description: Use the Radar Sidebar plugin's thread list and navigation. Use when the user asks about the sidebar's groups, filters, pins, sections, or how to switch back to BB's list.
---

# Radar Sidebar

Replaces BB's sidebar thread list and the navigation above it. There is no
CLI and no server state: everything below is UI in the BB app, and thread mutations go
through BB's own flows (pins, reads, renames, archives, deletes).

## Surfaces

- **Thread list** (`experimental_threadList`, id `radar`): pinned threads,
  then Today / Yesterday / Previous 7 days / Previous 30 days / Older — or
  group by project, or by **section** for drag-to-organise. The header is
  one row: a text filter and a view-options button (`RadarViewOptions.tsx`)
  whose panel holds status chips + smart views, Active / Archived / All,
  grouping, density (hidden on touch, which is always compact) and
  expand/collapse all. Active filters show as removable pills under the
  search; a bot or crew scope is the first pill (crew keeps only that pill
  and the +, since it has no search). The rail renders no heading: it hands
  New thread to a + at the end of the header row via `railNewThread.ts`,
  and its host styles hide BB's back/forward reserve row. Preferences persist per
  client in `localStorage` (`radar-sidebar:*:v1` keys).
- **Navigation** (`experimental_sidebarNavigation`, id `radar`): a primary
  New thread button, inline destination rows, and a **More** popover (count
  badge, highlighted while the current page lives in it). Search threads is
  not rendered: the list filter and the ⌘K palette cover it. Inline vs More
  and the row order follow BB's
  own stock arrangement exactly — the server-synced `sidebar.pluginPanelOrder`
  and `sidebar.visiblePluginPanels` preferences behind Settings →
  Customize sidebar — so More holds precisely what the user put there.
  The host navigation hook supplies the live arrangement, and its actions
  save visibility changes. Right-click a destination for Keep in sidebar /
  Move to More (so arranging in either nav carries over) and Open in
  split for panels. Option-click opens in a split. New thread is the fixed
  Radar header — always inline — while destinations follow the stock
  arrangement exactly.

## Navigation rail

Enable **Navigation rail** (`railNav`, default `false`) under Settings →
Installed plugins → Radar Sidebar. Both slots keep id `radar`. Off restores
navigation above the list, including the touch toolbar, and ignores the
remembered bot filter. Turning it back on restores that choice.

The rail sits beside the list on desktop (60px) and in the mobile drawer
(56px). BB still supplies destination order, visibility and actions. Search
stays on the rail; **Home** only clears the bot filter and never creates
or opens a thread. **New thread** remains BB's action, run from the + in
the list's header row.
Project tiles are removed in all modes; their saved filter is ignored.
Enable **Bot rail (experimental)** (`botRail`, default `false`) in Radar's settings
with `railNav` on to render faces below the plugin destinations. Coordinators
and their workers tuck into the rail. Tapping a face opens its coordinator and
shows only that bot's worker family, linked by parent or lifecycle owner across
projects; project membership alone never includes a thread. From a worker, the
face returns to the coordinator; from the coordinator, it shows all threads again,
as do Home and the scope pill's X; the pill's name opens the coordinator. The hover
card's View workers filters without opening anything.
**Crew** (above the faces, scope key `__crew__`) replaces the list with the
crew as a group chat. Each bot with something to say speaks in a bubble, most
urgent first: failures (red, "!" badge, Check), asks (amber, "?" badge, Reply),
work in flight (typing dots and the newest running worker), then unread replies.
Asks include a coordinator reply that is waiting on Salem, which stays open
after being read until the coordinator replies again: a `Decision needed:` line,
or else Jev's verdict on that reply (probability at least 0.5, quoting the
sentence it picked). Radar's server RPC `crew_asks` judges each settled
coordinator reply once per `latestAttentionAt`, through Auto Effort's plugin-only
`jev_decide` RPC (Auto Effort's key and model), and caches the verdict in plugin
storage for every client; rollovers and new bots are judged on first sight.
Without Auto Effort or its key, only `Decision needed:` counts, retried every
5 minutes. Asks also include worker questions, unseen worker failures,
and failed or stalled automations (watchers three intervals late) from
saelmbot-automations' `automations_overview`. "+N more" counts the rest. Bots with
nothing new sit below under **Resting** as a grid of tiles: sleeping face with
its context ring, name, age of the last reply and jobs started today; each opens
its coordinator and shows the last line as a tooltip. **Today** is a timeline of
every job the crew started today: live workers (hidden run threads included)
plus archived ones from `threads.list`. Consecutive jobs by one bot fold into a
card on the timeline, with the bot's face as the node (pulsing while a job runs),
a time range, done/failed/running tallies when it holds more than one job, and
up to 3 jobs before "+N more"; 6 cards show before "Show the whole day". Tapping a bubble opens the thread it is about. Selection uses the stable bot key, following
rollover; roster refreshes on thread creation/archive changes and every minute.
State dots describe only the coordinator family, with state words in accessible
labels and tooltips. Context rings and worker-count badges remain visible.
Live context refreshes every 15 seconds; coordinator identities survive rollover.
This mode hides the duplicate in-list deck and coordinator rows. Turning either
flag off shows all threads immediately and restores the deck if `botsDeck` is on.
An empty or unavailable roster leaves all threads accessible. New thread keeps
BB's usual project picker. The list also has its own clear-bot button if another
navigation provider is selected.

Desktop bot hover/focus cards show the latest reply, decision requests, worker
titles and states (waiting and failed first), context percentage and token counts,
model and machine. Open the coordinator or a worker directly, or choose View
workers to filter the list. The card stays open while the pointer crosses to it;
Tab enters its actions and Escape returns focus to the bot. Other rail tooltips
include shortcuts and accessories. Arrow keys wrap between enabled
controls; Home/End focus the first/last. Right-click destinations for Move to
More / Keep in sidebar, Move up/down, Open in split and Plugin details.
The rail's More is always present: hidden destinations, then Show/Hide labels
(when allowed) and Customize sidebar. Customize opens BB's editor beside the
desktop rail (More reads as open meanwhile); mobile uses BB's full editor.

**Labelled rail** (`wideRail`, default `false`) requires `railNav`. It adds a
Show labels / Hide labels entry to the rail's More on desktop. The 168px rail expands the
sidebar by its extra width so the thread list keeps its room. It probes the
host sidebar/footer/width structure and hides the toggle when unavailable.
The gutter, footer stacking and Customize layout use host `data-sidebar`
selectors in `components/radar/railHostStyles.ts`. The rail renders them
as `<style>` elements in its own markup, by state (wide, compact, scoped),
plus a small `<style>` for the measured footer reserve and scroll thumb.
Disabling the rail unmounts them and releases those styles. It never
writes to BB's elements, and it avoids `:has()` on the page or sidebar,
which restyled the whole page on every DOM change.
A BB shell update can require selector adjustments. Wide mode and tooltips
are desktop-only; safe-area padding and reduced motion are respected.

## Organisation tools

- **Grouping modes** (`Clock` / `Folder` / `SectionMove` icons): time,
  project, or section. Project groups are drag-reorderable by their header
  (order persisted in `radar-sidebar:project-order:v1`; right-click a header
  to reset). Each project header also carries a New-thread-in-project button.
- **Create a section**: switch to section grouping, choose **New section**,
  enter its name and submit with **Create section** or Enter. Cancel or Escape
  closes the form without creating anything. Names are trimmed; blank names
  are rejected. Creation uses `sdk.threadSections.create({ name })`, with
  duplicate submissions blocked while pending and inline API errors that keep
  the name for retry. BB's realtime sidebar state supplies the new section;
  empty sections stay visible even with no threads or no filter matches.
- **Drag to file**: in section grouping, hover a root thread to reveal its
  grip, then drag it onto a section header (or **Unfiled**) to set its
  `sectionId` through BB's own thread update — the drop target highlights,
  the thread's own section is marked as a no-op, and a toast confirms.
  Dragging a selected thread files the whole selection. For keyboard filing,
  focus the grip, press Space, move with arrow keys, and press Enter to drop
  or Escape to cancel.
  Threads cannot be moved between *projects*: BB's update API has no
  `projectId` field, so project grouping is view-only.
- **Smart views** (`RadarSmartViews.tsx`): the view-options panel offers a
  Pinned preset plus any saved view. Configure query + status chip +
  lifecycle, hit **Save view**, name it — stored in
  `radar-sidebar:smart-views:v1`. Click a pill to apply (click again to
  clear).
- **Hover preview** (`RadarHoverCard.tsx`): pausing on a row opens a portal'd
  card (portaled because row `content-visibility` containment would clip a
  fixed-position child) with an arrow pointing at the row. Sections: title +
  provider + status word + time; the initial goal; chips for model, thinking,
  section, project, host; branch (click to copy) and PR (click to open);
  a **stacked context meter** built from `threads.context` snapshot
  categories (used / reserved / deferred, with a legend of the four biggest)
  plus a marker at the auto-compaction threshold; folded-family names; and
  Open / Split / Pin / Archive actions. It is interactive, so it stays open
  while pointed at. **The context section is omitted entirely when BB records
  no usage** (a thread that never ran a turn) rather than showing a zeroed
  bar. Placement is measured in a pre-paint layout effect: the card prefers
  the row's right, flips left when that would overflow, and clamps to an 8px
  viewport inset on both axes, so no part of it can leave the screen; the
  arrow tracks the row's mid-height even after the card is nudged. It
  measures `offsetWidth`/`offsetHeight` (not `getBoundingClientRect`) so the
  entrance `scale()` can't skew the maths, and re-places when the context
  section arrives and changes its height.

## Selecting it

Settings → Appearance → **Sidebar** (list) and **Navigation** (controls).
Choosing BB there restores the stock experience; disabling this plugin falls
back to BB's list automatically.

## Row behaviour

- Status visual: spinning green loader = thread working; distinct pulsing
  green icons for background agent (bot), background command (terminal),
  workflow, goal (target), and plan mode (checklist); amber dot =
  needs input / message waiting to send, red X icon = error / failed send,
  green check-circle = finished but unseen. Rows that need you are the
  loudest: waiting-for-input gets an amber wash + bar + glow pulse, failed
  gets the red equivalents — both stay until resolved, whether read or
  not. Finished-unseen gets the green wash + bar + semibold title + blue
  pip, clearing once opened. Auto-resolving queued states keep just the
  dot/pulse. Motion is reserved for action items (off under
  prefers-reduced-motion); finished-unseen and everything else stays
  static. Drafts show no status dot
  (the pencil badge covers them). Unknown indicators draw nothing
  (forward-compatible), and the row's accessible name appends the host's
  status label.
- Row lead: just the provider icon (14px, hard-capped).
- Right-side badges, in order: status visual (spinner, dot, or icon) plus
  its explicit word (WORKING, AGENT, COMMAND, WORKFLOW, GOAL, PLAN,
  NEEDS YOU, QUEUED, FAILED, DONE — coloured to match), jump shortcut
  while the app command modifier is held (only rows on screen get one:
  rows in a folded family or collapsed group are skipped), another
  plugin's row status (takes the draft slot, as BB's list does), amber pip
  for an unsent composer draft, blue pip for unread.
- State changes animate: washes fade, badges pop in, quiet rows fold
  smoothly, and groups + families expand/collapse with an animated roll
  (rows stay mounted only while the fold closes, hidden from keyboard and
  screen readers, then unmount so a folded group or family costs nothing;
  all off under prefers-reduced-motion).
  Threads flipping from live work to done get a one-time springy
  check-pop on their status badge.
- Adaptive rows (`adaptiveCollapse`): quiet read-idle rows collapse to the
  title line (title, project chip, time) and drop the subtitle, keeping
  only the branch line (which always shows). Anything worth a glance
  (unread, working, needs-you, failed, drafts, plugin statuses, PRs needing
  attention, unknown states) keeps the full row. Editing never collapses.
- Compact density compresses **vertically only** — inline padding and the
  child indent stay identical to comfortable so tree guides keep lining up.
  Titles stay on one line by default; **Two-line titles** also applies to
  compact density and the forced-compact touch layout.
  It uses `margin-block` rather than `margin`, since the shorthand also
  zeroes `margin-left` and wipes `.radar-row-child` / `.radar-row-deep`.
  `css.test.ts` guards both as static assertions (jsdom does not resolve the
  real cascade).
- Pinned rows carry a small pin marker at the start of the title, so
  pinned children nested under unpinned parents stay recognisable (and
  `pinned` joins the row's accessible name).
- Hover cards (`hoverCard`): pausing on a row (hover-capable pointers only)
  opens the interactive preview described under **Hover preview**. It
  closes on leave, scroll, window blur, or when a menu opens.
- Responsive: container-query width tiers shed load as the sidebar
  narrows (status words first, then project chips, then badges down to
  status + unread); compact touch viewports pin the ⋯ menu inline since
  hover doesn't exist there, and filters wrap.
- Title line: title, then a project chip in the project's own muted hue
  (stable per project id, readable light and dark — always shown, even on
  collapsed rows and children, hidden only when it would echo the project
  group header), then a muted tabular last-activity time that never
  truncates.
  Choose **Two-line titles** to wrap the whole title, including mention
  chips, before truncating at two lines. Metadata stays beside short titles
  when it fits, or wraps below aligned with the text after child/pin markers.
  Groups, sorting, and timestamps all key off activity — live threads
  (executing, background work, queued messages, waiting on you) count as
  now, everything else keys off latest attention — so merely opening a
  thread never floats it to Today.
- Subtitle: model and thinking each in an outlined chip (bot icon +
  semibold model name, brain icon + uppercase level), then a section chip
  in the section's own muted hue (stable per section id) and host.
  **Shown only while the thread is in flight** (`isLiveThread`):
  `threads.defaultExecutionOptions` resolves *defaults*, so it answers with a
  model and reasoning level for any thread at all — including idle and
  never-started ones. Idle rows skip the fetch and render no chips. The provider name is not echoed in the row (the icon
  says it) unless no icon is available; `Off` thinking and the home host
  (whichever host runs the most threads) are omitted as noise — branches
  live on line three, away-from-home hosts always show. Model names
  resolve through each provider's catalog; a shimmer stub holds the place
  while loading. The full text is always in the tooltip. Model info
  refreshes when a thread starts a new run, records newer activity, or the
  window regains focus; regrouping within the same run reuses cached values.
- Threads on a branch grow a third line: icon + branch name (a git-folder
  icon for worktrees, a branch icon for plain checkouts, with `(worktree)`
  in the tooltip), plus a PR badge when the branch has one (`#123 · Open`,
  coloured by attention: red for failed checks/conflicts, amber for changes
  requested/blocked, blue for review pending, green for ready/merged).
  Clicking the badge opens the PR. The branch never appears on line two.
- Hover actions: pin, rename (pencil), archive/unarchive, and a menu (⋯).
  They never resize the row. In one-line mode they sit at its top right. In
  two-line mode they sit on its last line of plain text (the subtitle, or
  the chip and time where the subtitle is folded away), lifted clear of the
  branch line so the PR badge stays clickable; only a row one line tall
  still has them over the end of its title.
  Right-click opens the fuller menu: open in split, pin, mark read/unread,
  mark family read (whole tree, for threads with parents or children —
  a child's completion lands as the parent's own notification turn, so
  clearing one often means clearing both), rename, move to section,
  archive/unarchive, copy link, delete (host confirmation).
- Double-click a row to rename inline; Enter commits, Escape cancels.
- Child threads nest directly under their parent (indented, person icon,
  deeper indent past one level, VS Code-style indent guides with stubs on
  last children), and child activity bubbles up: a family
  groups/sorts by its freshest activity, so an active child floats its
  parent. Children show model • thinking + time only — no branch line, no
  echoed context (the tooltip keeps everything). Placement follows the
  root's pin state; orphans whose parent is hidden promote to roots.
  Filtering keeps matching branches plus their ancestor context. Families
  fold via the gutter chevron (persisted per client; group headers stick
  while scrolling; filtering forces everything open). A collapsed
  parent swaps its subtitle
  for an inline
  summary of who's folded (stacked people faces + remainder, names in
  the tooltip), keeps its branch line, and shows a pill
  only when the fold hides unseen threads (blue count) or loud states
  (red failed, amber needs-you, pulsing green live rollup dot). Group
  counts/rollups always include folded members and count each thread. Failed
  work takes priority over input waits, which take priority over running work.
- Hidden helper threads (`isHidden`) are filtered out, as in BB's list.

## Keyboard and selection

- `/` focuses the text filter. In the filter, ↓ moves to the first row,
  Enter opens it, and Escape clears the query (or leaves the field when it
  is already empty).
- ↑ / ↓ walk the rows, Enter opens, and Space, ← or → fold or unfold a
  family. E archives and P pins or unpins the focused row.
- These shortcuts stay out of text fields, open dialogs and menus, and
  buttons or links outside the list, and never apply to a key another handler already consumed or one held
  with ⌘, Ctrl or Alt. The focused row (or the last one reached with ↑ / ↓)
  is the target.
- X toggles the focused row into the selection (⇧ adds the range).
  ⌘- or Ctrl-click does the same with the mouse; ⇧-click adds the range
  from the last selected row. A bulk bar then offers Archive, Pin and Read,
  and E and P act on the whole selection. Selection only ever holds rows the
  list still shows: filtering one out deselects it.
- Escape clears the selection first, then the focused row, then the query.

## Settings

`bb plugin config radar-sidebar`, or Settings → Installed plugins → Radar
Sidebar. The frontend reads them through `useSettings()`, and every value
has a default, so the list never waits on them. Until they load,
`defaultDensity` and `twoLineTitles` use the value this client last saw, so
rows paint at their final height.

| Key | Default | Effect |
| --- | --- | --- |
| `railNav` | `false` | Navigation rail beside the list; off keeps navigation above the list. |
| `botRail` | `false` | Experimental bot faces, family state dots and bot scoping; requires `railNav`. |
| `wideRail` | `false` | Experimental labelled desktop rail; requires `railNav` and a recognised host shell. |
| `hideWorking` | `false` | Families with any live work (turn running, follow-up queued, background agents, commands, workflows, goals or plan mode — anything with a spinner) and nothing waiting on the user leave their group for a **Working** drawer pinned under the list, folded by default (open state: `radar-sidebar:working-open:v1`). Needs-you, pinned, bot coordinators and the open thread's family stay put; search or a status filter shows them in place. Hovering the drawer's header (mouse only) opens the Working peek (`RadarWorkingPeek.tsx`): every live thread in the drawer with a server-side digest from its latest timeline segment (`working_digest` RPC, `lib/workingDigest.ts`, cached 4s, polled every 6s while open) — latest words, newest step, phase, steps, todos, goal, context, and flags for quiet 5m+, 2+ failing commands, 80%+ context, a model fallback, background work or a waiting question. |
| `hoverCard` | `true` | Show the hover peek card. |
| `celebrate` | `true` | Pop the check badge once when a thread finishes. |
| `motion` | `true` | Pulse rows that need input or have failed; off under `prefers-reduced-motion` regardless. |
| `loudUnread` | `true` | Wash and accent bar on finished-but-unseen rows; off keeps the icon and pip only. |
| `adaptiveCollapse` | `true` | Fold quiet read-idle rows to their title line. |
| `defaultDensity` | `comfortable` | `comfortable` or `compact`, until the header toggle is used; that choice is remembered per client. |
| `twoLineTitles` | `false` | Enable to wrap long titles, including mentions, in both densities; metadata wraps below when needed. |
| `swipeActions` | `true` | Swipe a row left or right to act on it, by touch or with two fingers on a trackpad. |
| `swipeRight` | `Mark read / unread` | Rightward swipe action: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` or `Nothing`. |
| `swipeLeft` | `Archive / unarchive` | Leftward swipe action, same options. |

## Rail storage keys

- `radar-sidebar:rail-bot-scope:v1`: selected bot key; absence means all threads. The retired `rail-scope:v1` project filter is ignored.
- `radar-sidebar:rail-wide:v1`: `1` for expanded labels, `0` for icons.

These are client preferences inside the same plugin, alongside the existing
filter, density, smart-view, project-order and collapse keys.

## Rules

- Never edit `localStorage` or `bb.db` to change sidebar state; use the UI.
- The list renders no virtualisation: very large thread counts (thousands)
  may scroll slowly on low-end machines. Prefer the text filter or Archived
  separation in that case.
- `app.css` is custom CSS against BB theme tokens; Tailwind utilities in
  `components/radar/*.tsx` compile in the plugin build. Keep new styles
  behind the `radar-` prefix.
