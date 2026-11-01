# Read state and open-thread presence

Radar mounts `ThreadPresence` as an SDK `experimental_appOverlay`, independently of the selected sidebar or phone drawer. `useBbContext().threadId` must identify the displayed thread route. When splits exist, the focused pane must show that same thread. A retained split after navigating to Skills, settings, a plugin page, or another thread does not establish presence or mark its hidden thread read.

Only a visible document with `document.hasFocus()` counts. Opening or returning to the thread calls `sdk.threads.markRead({threadId})`. Changes to `latestAttentionAt` or `isUnread` call it again while focused. `updatedAt` is not used because reading can itself change it. Read errors are contained and retried by later attention/focus changes.

## Leases

Each overlay instance has a random client ID and an increasing heartbeat sequence. It reports immediately on navigation/focus/visibility changes and every 20 seconds while active. Page hide and disposal send a close. Unload delivery is best effort; a missed close expires after 60 seconds. Out-of-order messages cannot undo a newer close while the client entry is retained.

Leases use the server's monotonic `performance.now()`, so wall-clock corrections cannot extend a vanished client's presence. Multiple clients hold the thread open until the last lease closes/expires. Restart clears in-memory presence until clients heartbeat again.

Authenticated RPCs:

- `presence_heartbeat`: `{clientId, sequence, threadId: string|null, visible}` → `{ok:true}`.
- `presence_open`: `{threadId}` → `{open:boolean}`. Checks expiry immediately, without waiting for the housekeeping sweep.

Radar never reads or writes native notification preferences, never mutes a thread, and stores no restore records. Navigation, leases, restart, expiry, and focus changes cannot change any thread's notification level.

## Coordinator finished pushes

The matching bots core release enrolls registered bot coordinators at a steady native `input-only` own level, recording each thread's previous own level once in its own SQLite database. Replacement coordinators are enrolled directly, without copying a predecessor's preference snapshot. Other threads' levels are untouched. Existing native notification delivery claims are released: BB continues to deliver questions, approvals and errors, including those on children. The input-only ancestor cap allows those notification kinds through.

Core sends coordinator finished replies through the public `push-notifications` `notifications.send` RPC. It uses BB 0.48.1's title fallback, 80/180-character limits, readable first paragraph, markup removal and thread-reference titles, with the same thread tap target and empty-body fallback. Read/hidden/deleted/archived threads, stale completions and pending native interactions do not produce a duplicate finished push. Durable completion sequence receipts prevent repeated idle events or restart from repeating an attempted/skipped push.

Presence is queried immediately before delivery. An open destination consumes that finished push without replaying it when Salem leaves. New completions after leaving notify normally. Missing/unavailable Radar fails open after a two-second lookup timeout. Saved notification-center rows remain available; their reply classifier no longer sends a second reply push. Native form rows also remain visible without a duplicate center push.

Core reminder buzzes and Brrr's direct CLI/tool sends retain their presence checks. Critical baby delivery is unchanged. The plugin still refuses critical input.

`bb saelmbot coordinator-pushes status` inspects enrollment snapshots. `bb saelmbot coordinator-pushes restore` explicitly pauses this delivery owner durably and restores saved own levels where the thread still has its managed `input-only` value. Later user changes are left alone. It never deletes the original snapshot. Failed/pending setup or restore rows remain visible for a later explicit retry. This is a rollback operation, not an operation on opening/closing a view. No restore command was run during implementation.

## Boundaries

This targets registered coordinator finished replies, reminders and direct Brrr sends. Ordinary threads keep BB's native notification behavior; presence alone cannot suppress their mobile finished pushes. Questions, approvals and errors intentionally retain native delivery. PC presence suppresses coordinator finished pushes to the phone server-side, regardless of whether the phone itself reports presence.

Suppression starts only after the plugin frontend loads and its heartbeat reaches the server. BB may defer frontend boot. A background/crashed client can count as open for up to 60 seconds; a notification already handed to a delivery service cannot be recalled. Pending two-second completion timers do not survive a core restart, matching native in-memory coalescing behavior. An uncertain explicit send is recorded as attempted and is not automatically retried.

## Mobile evidence (read, not device-tested)

The local official BB source at commit `01affc197` contains:

- `apps/mobile/app.json`: Android package and iOS bundle ID `app.getbb.mobile`.
- `apps/mobile/app/webview.tsx`: renders `ProfileWebViewScreen`.
- `apps/mobile/src/screens/webview/ProfileWebViewScreen.tsx`: renders the chosen server's web app with JavaScript enabled in `react-native-webview` on both platforms.
- `apps/app/src/App.tsx` and `hooks/usePluginFrontendBoot.ts`: boot plugin frontends without a mobile exclusion.
- `apps/app/src/components/layout/AppLayout.tsx`: mounts `PluginAppOverlays` outside the sidebar state bridge.

The source mobile shell therefore loads plugin apps. Salem's installed Android/iOS builds and their focus/background event behavior remain unmeasured.

## Post-deploy checks

1. Capture each coordinator's previous own level. Verify `coordinator-pushes status` records it once, native own levels become input-only, and unrelated/child own levels are unchanged. Reload and verify snapshots remain the originals.
2. Open a coordinator on PC: unread clears and presence reports open. Native level stays input-only on open, close, focus and lease expiry.
3. Complete a coordinator reply while open: no finished phone push. Leave and complete another reply: one push with the native title/preview, tapping into the correct thread. Repeated idle events must not duplicate it.
4. Navigate to Skills/settings with a retained split: its hidden thread must report closed and remain unread when new activity arrives. Return and focus it to mark read. Switch focused split panes and test blur/minimize.
5. With a coordinator open, trigger an unseen child's question/approval/error: BB must still deliver it. Verify center/native ownership does not suppress or duplicate it.
6. Verify due reminder buzzes and authorized direct Brrr test sends skip an open target while saved reminder rows remain; a new event after leaving notifies normally. Critical baby delivery remains separate.
7. Hold one thread in two clients. Closing one must retain presence; killing the final client must expire it in about 60 seconds. Restart Radar: presence starts empty and no native preference changes.
8. Roll over a coordinator: the replacement gets input-only and its own original snapshot, independently of the old thread's current value. Use the restore command only as an explicitly authorized rollback and verify exact saved values, including absent/inherit.
9. Check Android and iOS opening, backgrounding, locking and returning. Report installed-build gaps separately from the source finding.

## Read-only baseline (2026-11-01)

Earlier read-only checks found all six current coordinators effective `all`. Own values were Personal/Work/Lab `inherit`, Home/Bricks/ERBareeq `all`. Nothing was changed during implementation. Capture the current values again before deployment because coordinators can roll over.
