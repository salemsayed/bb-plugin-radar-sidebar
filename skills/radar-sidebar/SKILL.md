---
name: radar-sidebar
description: Use the Radar Sidebar plugin's thread list and Crew workspace. Use when the user asks about the sidebar's groups, filters, pins, sections, or how to switch back to BB's list.
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
  search; a bot or crew scope is the first pill (crew keeps only that pill
  since it has no search). BB owns New thread in its native header.
  Preferences persist per client in `localStorage` (`radar-sidebar:*:v1` keys).
- **Crew** (`navPanel`, id `crew`): a full overview, Chat and History reached from BB's native rail.

## Bot shortcuts

Enable **Bot shortcuts** (`botRail`, default `false`) in Radar's settings. Bot faces sit above the list filter, independent of BB's rail layout. A face opens the current coordinator and filters the list to its workers; tap the chosen face from that coordinator again, or Home, to show other threads. Crew is reached from BB's native navigation. Hover/focus a bot on desktop for reply, worker, model and context details; arrow keys traverse shortcuts and Escape closes details.

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

Settings → Appearance → **Sidebar** selects the thread list. BB owns navigation.
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
| `botRail` | `false` | Bot faces, family state and worker filtering above the list. |
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


## Crew workspace

Crew opens from the native rail. Needs your answer comes first, followed by actual bot/worker activity and compact reminders. Activity uses BB's runtime and registered lineage, including hidden active workers and predecessor-owned children; imported requests never count as work in progress. Pending input links to the actual affected thread. Native Chat and History are secondary views. Settings, tracked assignments and receipt checks remain under Settings & activity log. Durable work/request records, direct-chat reporting, source history, acknowledgments and an outbox back the page. Current deployment is live and unpaused at Salem's request. `bb crew status --json` reports mode, work, requests and receipt states. `bb crew control --mode live|shadow --paused yes|no` changes control state. Old shadow proposals require explicit Send; mode changes never dispatch them automatically.

Use structured Crew questions; opening a sidebar never extracts requests from prose. Manager assignments bind real user-event authorization and preserve the original objective. Owning bots can adopt direct work without redispatch, read their own registered lineage, and bind exact direct answers across rollover. Track worker IDs and require delivery, verification and cleanup evidence before completing new work; active or question-pending workers block completion/cancellation acknowledgment. Existing reminders and historical sources remain supported. Routine progress, source imports and standalone questions update the page quietly. Only important reports on Crew-assigned work and real human replies that may answer an existing request automatically wake Crew. A settled owning-bot reply is required for answer review; automation/worker/tool notices do not qualify. Reconciliation retries at most three times per human reply across reload, five minutes apart; later automated replies do not reset that budget. Exhausted review is shown on the board. A new human reply or `bb crew reconcile --json` permits another check.

Use `bb crew tool --name <crew_tool> --input '<JSON>'` from the owning bot or Crew thread if native tools are unavailable in an older session. Same ownership and version checks apply. Never retry an uncertain send with a new ID: use the original command's receipt check. Crew is registered as bot `crew` in its own project. Automatic rollover is enabled at 75%; handoff and predecessor handling use saelmbot. Use `bb saelmbot rollover now --bot crew` for manual rollover. Radar follows the current registered thread and hides it from ordinary lists. Durable per-bot, per-conversation answer cursors retain registered predecessors and catch up after reloads; `bb crew reconcile --json` requests a check without dispatching specialist work. See `docs/crew-coordinator.md` for exact behavior. ChatGPT dots and voice integration are excluded.
