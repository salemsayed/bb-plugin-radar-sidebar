A thread list you can read at a glance, for BB.

## What you get

- **Native BB navigation, with bot shortcuts.** BB owns the rail, More and New thread. Enable `botRail` for bot faces, state and worker filtering above Radar's list. Saved bot asks and alerts are rows in the list's Needs-you lane.

- A **Radar thread list** in the left sidebar. Threads group by Today,
  Yesterday, Previous 7 days, Previous 30 days or Older, keyed off real
  activity rather than when you last opened them, so merely reading a thread
  never floats it to the top. Group by project or by section instead with one
  setting, and reorder projects by dragging them.
- **One colour per meaning.** Blue is running, green done, amber needs you,
  red failed, muted queued. Only rows needing a decision are tinted (amber or
  red, with a slow glow), so a tinted row always means act on it. Rows keep
  their height and hold their order while you point at or touch the list.
- **Nested families.** Child threads sit under their parent with indent
  guides, and a family sorts by its freshest activity. Fold one and the
  summary tells you how many are hidden, how many are unseen, and the loudest
  state inside.
- **Rows that carry their context.** Provider icon, model and thinking level
  while a thread is in flight, plus a branch line you can copy and a
  pull-request badge that opens in your browser. Pause on a row for a peek
  card with the original goal and a stacked context-window meter.
- **For working fast.** Status filter chips (Pinned among them), a text
  filter, keyboard traversal with quick
  archive and pin, multi-select bulk actions, and drag a thread onto a section
  header to file it.

## How it works

Radar reads BB's live sidebar state and routes mutations through the supported SDK. An always-mounted app overlay marks the displayed, focused, visible thread read and sends presence heartbeats. The server tracks short monotonic leases in memory, without reading or writing native notification preferences.

Bots core and Brrr query presence before explicit pushes/buzzes. Coordinator native levels stay input-only so BB can deliver questions, approvals and errors, including on children. Core owns the finished-reply pushes. See [details and mobile evidence](docs/thread-presence.md).

Pick it under **Settings → Appearance → Sidebar**; choosing
BB there, or disabling the plugin, restores the stock sidebar immediately.

Two limits worth knowing: it will not move a thread between projects, because
BB's thread API exposes no project on update, and it shows model and thinking
only while a thread is actually running, because the options endpoint resolves
defaults rather than history.

## For agents

The bundled skill documents the groups, filters, folding, badges, menus,
settings and storage keys, so an agent can explain or troubleshoot the sidebar
without guessing at internals.
