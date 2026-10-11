---
name: radar-sidebar
description: Use the Radar Sidebar plugin's thread list and bot Attention panels. Use when the user asks about the sidebar's groups, filters, pins, sections, or how to switch back to BB's list.
---

# Radar Sidebar

Replaces BB’s sidebar thread list. BB owns the native navigation rail. There is no
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
  search; a bot scope is the first pill. BB owns New thread in its native header.
  Preferences persist per client in `localStorage` (`radar-sidebar:*:v1` keys).
- **Bot Attention** (`threadPanelAction`, id `bot-attention`): questions, reminders and important updates inside each bot coordinator, opened through its Attention header action. Crew navigation is retired.
- **Thread actions**: row More and context/long-press menus use BB's shared registry, including Notifications and other plugins' actions. Mobile choices open native drawers. Keyboard, swipe and bulk archive/delete actions keep BB's confirmation and Undo flows. Requires SDK 0.6.37.

## Bot shortcuts

Enable **Bot shortcuts** (`botRail`, default `false`) in Radar's settings. Bot faces sit above the list filter, independent of BB's rail layout. A face opens the current coordinator and filters the list to its workers; tap the chosen face from that coordinator again, or **All** at the start of the row, to show every thread. BB's rail Home only switches the sidebar to this list and keeps the bot filter. A badged bot opens its Attention panel automatically, including direct entry to its current coordinator. Hover/focus a bot on desktop for reply, worker, model and context details; arrow keys traverse shortcuts and Escape closes details.

States and unread badges retain the same meaning as the bot deck. Saved bot scopes and hidden preferences persist. Open asks, pending input and unread failures keep a hidden bot accessible. Turning shortcuts off restores the deck. Retired `railNav` and `wideRail` values have no effect. Navigation, arrangement, More and the footer belong to BB, without shell CSS overrides or removed SDK calls.

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
  Pinned preset plus any saved view. Status chips: Live (running work or a
  pending question), Waiting (Needs you only: `waiting-for-input` or a
  pending interaction; held and queued messages excluded), Unread, Pinned.
  Configure query + status chip +
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

Settings → Appearance → **Sidebar** selects the thread list. BB owns navigation.
Choosing BB there restores the stock experience; disabling this plugin falls
back to BB's list automatically.

## Row behaviour

- Colour legend: blue = running, green = done, amber = needs you, red =
  failed, muted = queued or held, tinted row = act on it.
- Status visual: spinning blue loader = thread working; one pulsing blue
  icon for background agent (bot), background command (terminal),
  workflow, goal (target), and plan mode (checklist); amber dot =
  needs input, muted clock + QUEUED = message queued behind a running turn,
  muted pause + HELD = message parked on an idle thread until the user sends
  it (`isHeldThread`: not live, so outside the Working drawer, live filter
  and counts, sorted like idle, idle for bots and Crew), red X icon = error /
  failed send, green check-circle + DONE = finished but unseen (static).
  Only rows that need you are tinted: waiting-for-input gets an amber wash
  + 3px left bar + glow, failed gets the red equivalents — both stay until
  resolved, whether read or not. Plain unread is a semibold title plus a
  blue pip (no pip when the DONE badge already shows). The left bar
  carries state only: selection is a tint plus the checkbox, and a row open
  in a split pane gets a thin mark on its right edge. At most one loop per
  row (spinner, icon pulse, or the needs-you/failed glow); status words
  never blink; all off under prefers-reduced-motion. Drafts show no status dot
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
  for an unsent composer draft, blue pip for unread (not beside DONE).
- Stable rows: a row's height never changes with its state, and while the
  pointer is over the list (or for 600ms after a touch or scroll ends) rows
  keep their order and update in place; new threads join the end of their
  group. The new order lands after ~400ms without pointer movement
  (`useFrozenOrder.ts`). A live thread sorts by when it went live, not by
  the clock, so it does not keep floating.
- State changes are calm: washes fade, the badge strip pops in once when a
  row appears, and groups + families expand/collapse with an animated roll
  (rows stay mounted only while the fold closes, hidden from keyboard and
  screen readers, then unmount so a folded group or family costs nothing;
  all off under prefers-reduced-motion).
  Threads flipping from live work to done get a one-time springy
  check-pop on their status badge.
- Rows always keep their full layout: a state change never adds or removes
  a line (the old "Collapse quiet rows" setting is gone).
- Compact density compresses **vertically only** — inline padding and the
  child indent stay identical to comfortable so tree guides keep lining up.
  Titles stay on one line by default; **Two-line titles** also applies to
  compact density and the forced-compact touch layout.
  It uses `margin-block` rather than `margin`, since the shorthand also
  zeroes `margin-left` and wipes `.radar-row-child` / `.radar-row-deep`.
  `styles/styles.test.ts` guards both as static assertions (jsdom does not resolve the
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
- Title line: title (one leading status emoji such as 🟢 ✅ ❌ ⏳ dropped
  from the shown text when the title has no mentions; tooltip, accessible
  name, rename and hover card keep it), then a project chip in the project's
  own muted hue (stable per project id, always 75°–325° so never in the
  red-to-amber band of Failed and Needs you, readable light and dark — always shown, even on
  children, hidden only when it would echo the project
  group header), then a muted tabular last-activity time that never
  truncates.
  Choose **Two-line titles** to wrap the whole title, including mention
  chips, before truncating at two lines. Metadata stays beside short titles
  when it fits, or wraps below aligned with the text after child/pin markers.
  Groups, sorting, and timestamps all key off activity — live threads
  (executing, background work with any messages queued behind it, waiting
  on you) sort by when they went live, everything else (held messages
  included) keys off latest attention — so merely opening a
  thread never floats it to Today.
- Subtitle: model and thinking each in an outlined chip (bot icon +
  semibold model name, brain icon + uppercase level), then a section chip
  in the section's own muted hue (stable per section id, same 75°–325°
  range) and host.
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
- Hover action: a single ⋯ (More actions); pin, rename and archive are in
  that menu, the context menu and swipes. It never resizes the row. In
  one-line mode it sits at its top right. In two-line mode it sits on its
  last line of plain text (the subtitle, or the chip and time on a row
  without one), lifted clear of the
  branch line so the PR badge stays clickable; only a row one line tall
  still has it over the end of its title.
  Right-click opens the fuller menu: open in split, pin, mark read/unread,
  mark family read (whole tree, for threads with parents or children —
  a child's completion lands as the parent's own notification turn, so
  clearing one often means clearing both), rename, move to section,
  archive/unarchive, copy link, delete (host confirmation).
- Rename from the ⋯ menu, the context menu or a swipe (not double-click,
  which misfired on rows); Enter commits, Escape cancels.
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
  (red failed, amber needs-you, pulsing blue live rollup dot). Group
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
| `botRail` | `false` | Bot faces, family state and worker filtering above the list. |
| `hideWorking` | `false` | Families with any live work (turn running, follow-up queued, background agents, commands, workflows, goals or plan mode — anything with a spinner) and nothing waiting on the user leave their group for a **Working** drawer pinned under the list, folded by default (open state: `radar-sidebar:working-open:v1`). Needs-you, pinned, bot coordinators and the open thread's family stay put; search or a status filter shows them in place. Hovering the drawer's header (mouse only) opens the Working peek (`RadarWorkingPeek.tsx`): every live thread in the drawer with a server-side digest from its latest timeline segment (`working_digest` RPC, `lib/workingDigest.ts`, cached 4s, polled every 6s while open) — latest words, newest step, phase, steps, todos, goal, context, and flags for quiet 5m+, 2+ failing commands, 80%+ context, a model fallback, background work or a waiting question. |
| `hoverCard` | `true` | Show the hover peek card. |
| `celebrate` | `true` | Pop the check badge once when a thread finishes. |
| `motion` | `true` | Pulse rows that need input or have failed; off under `prefers-reduced-motion` regardless. |
| `defaultDensity` | `comfortable` | `comfortable` or `compact`, until the header toggle is used; that choice is remembered per client. |
| `twoLineTitles` | `false` | Enable to wrap long titles, including mentions, in both densities; metadata wraps below when needed. |
| `swipeActions` | `true` | Swipe a row left or right to act on it, by touch or with two fingers on a trackpad. Starts only when sideways travel passes 12px and 1.5× vertical travel (`swipeIntent`); arms at max(64px, 40% of the row) for touch; a flick commits short of that only after arming once. |
| `swipeRight` | `Mark read / unread` | Rightward swipe action: `Mark read / unread`, `Pin / unpin`, `Archive / unarchive`, `Open in split`, `Rename`, `More actions`, `Delete…` or `Nothing`. |
| `swipeLeft` | `Archive / unarchive` | Leftward swipe action, same options. |

## Bot selection storage

- `radar-sidebar:rail-bot-scope:v1`: selected bot key; absence means all threads. The retired `rail-scope:v1` project filter is ignored.
- The retired `radar-sidebar:rail-wide:v1` value is ignored.

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


## Bot Attention

The Attention panel replaces Crew. The dot means unseen important occurrences; the question badge means an unanswered decision or due action. Reading BB history, bot auto-read and ChatGPT callback acceptance are separate from human seen. A displayed occurrence clears only after its complete content stays foreground-visible; collapsed, offscreen and newly arriving updates remain unseen.

Each saved question/reminder appears once with its exactly linked context. Reply prepares a native saved-question mention in an empty coordinator draft, or opens the linked native form. It sends nothing. Source opens the original conversation with a current-coordinator fallback if deleted. Seen acknowledges only this card's occurrences; it does not answer a question or complete work. Done settles an obligation. Later defers it. Closed records fold into History, future/held reminders into Later, and unfinished owner work into With the bot. Important completion updates remain active until seen even after the old question is answered.

All surfaces read the same durable bot-owned board. Jev is advisory: independent owner verification, exact source and transition guards govern changes. Preserve the latest approved notification preferences and explicit holds; completion, answer, seen and transport acceptance never grant new execution permission.
