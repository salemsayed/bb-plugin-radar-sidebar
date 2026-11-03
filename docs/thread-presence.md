# Read state and open-thread presence

Radar mounts `ThreadPresence` as an SDK `experimental_appOverlay`, independently of the selected sidebar or phone drawer. `useBbContext().threadId` must identify the displayed thread route. When splits exist, the focused pane must show that same thread. A retained split after navigating to Skills, settings, a plugin page, or another thread does not establish presence or mark its hidden thread read.

Only a visible document with `document.hasFocus()` counts. Opening or returning to the thread calls `sdk.threads.markRead({threadId})`. Changes to `latestAttentionAt` or `isUnread` call it again while focused. `updatedAt` is not used because reading can itself change it. Read errors are contained and retried by later attention/focus changes.

## Leases

Each overlay instance has a random client ID and an increasing heartbeat sequence. It reports immediately on navigation/focus/visibility changes and every 20 seconds while active. Page hide and disposal send a close. Unload delivery is best effort; a missed close expires after 60 seconds. Out-of-order messages cannot undo a newer close while the client entry is retained.

Leases use the server's monotonic `performance.now()`, so wall-clock corrections cannot extend a vanished client's presence. Multiple clients hold the thread open until the last lease closes/expires. Restart clears in-memory presence until clients heartbeat again.

Authenticated RPCs:

- `presence_heartbeat`: `{clientId, sequence, threadId: string|null, visible, through?: number|null, messageSeq?: number|null}` → `{ok:true}`.
- `presence_open`: `{threadId}` → `{open:boolean}`. Checks expiry immediately, without waiting for the housekeeping sweep.

## Display-confirmed read boundary

`presence_read_point` accepts `{threadId}` and returns `{through: number|null, messageSeq: number|null}`. This boundary is independent of the open lease. Only an accepted, newer heartbeat with a visible thread and a nonnull boundary can advance it. The highest confirmed message sequence and its associated server event timestamp are saved as one observation; maxima from separate heartbeats are never combined. Equal timestamps do not cover a later sequence. Missing close heartbeats, polling, expiry and server clock changes never increase it. Each thread's maximum is stored in SQLite and survives restart, while open leases still start empty.

The overlay samples BB's existing `[data-notification-thread][data-notification-message]` rendered message anchors every 400 ms while focused. A message must intersect the viewport and pass a hit test, so unrendered, hidden, occluded and offscreen messages provide no evidence. It resolves the newest visible sequence with one bounded SDK event query, rechecks the route, visibility and anchor after the asynchronous response, then carries that event's `createdAt` and exact sequence on the heartbeat. Already confirmed sequences need no repeated query. Sidebar activity times and local wall-clock times are never read boundaries. Missing host anchors or event lookup failures leave the boundary unchanged. Failed or missing event lookups use monotonic exponential backoff from 1 second to a 60-second cap, resetting after successful confirmation.

Core uses this boundary for automatic notification reads. `presence_open` retains its existing lease contract for Brrr and push suppression. Older clients may omit `through` or `messageSeq`; they continue to hold open leases without establishing read evidence. Timestamp-only stored records are not imported into the paired boundary table. This integration requires the corresponding core release and host message anchors. Live desktop/mobile behavior still needs post-deploy verification.

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

## Remember reading position

The old return pill is removed. The `rememberScroll` boolean setting defaults to true and disables all position reads, writes and DOM changes when off. Core's presence and display-confirmed read-point RPCs remain unchanged; read confirmation no longer waits for a pill to be followed.

SQLite table `radar_scroll_positions` stores `{atBottom,messageSeq,offset}` by thread and browser ID. Each browser keeps its ID in localStorage. Positions are per browser because phone and desktop wrap messages differently and simultaneous clients should not overwrite each other's reading places. Clearing browser storage creates a new identity. Private sessions and blocked localStorage cannot retain an identity; blocked storage disables restoration. The validated local cache seeds a visit; SQLite holds the durable copy. The additive table is ignored by previous releases, so rollback remains readable.

While active, capture the first message intersecting the container top, including partially clipped messages, with its signed pixel offset. Within 24 pixels of bottom store `atBottom`; native following then continues. Save immediately on scroll, sample every 400 ms and 120 ms after scroll, and serialize writes within a visit. Teardown does not take a fresh geometry sample. Hidden clients do not sample. Multiple tabs in the same browser share one record; the latest write wins.

Radar uses an owned message fragment when asking the host to load older pages, and for early restoration on ordinary document navigation. Automatic requests clear the address-bar fragment immediately after dispatching the native router event, so even a reload during recovery starts on BB's normal view. A session marker distinguishes Radar's fragment from explicit message links. Reaching bottom or turning the setting off also removes Radar's fragment; explicit links remain owned by the user. Startup uses the last known enable flag and waits for settings to resolve before changing it or the route.

`useLayoutEffect` starts the DOM controller on thread entry and focus return. It finds the nearest vertical scroll ancestor of the thread's message anchors and never changes visibility. It applies validated cached coordinates synchronously, on DOM mutation, and on animation frames. Missing anchors request the existing host message route once. Correction continues for up to six seconds after the anchor appears; missing anchors have an eight-second container deadline and a ten-second overall deadline. These bounds add no intentional blank interval. Wheel, touch, pointer and navigation-key input cancel correction immediately. The server supplies a fallback when there is no validated local cache. The read-point and presence contracts remain unchanged.

The integration depends on host DOM and router behaviour because the SDK has no chat-scroll lifecycle API. In particular, a cold host can paint or load its timeline before the overlay starts. The live matrix measures the actual visible transition, not just the eventual saved offset. `window.__radarScrollDebug` enables numeric lifecycle events for the test recorder; it is off normally. Explicit message links take precedence over automatic restoration. Native iOS lifecycle behaviour and future host DOM changes are outside the Chrome matrix.

## Repeatable installed-build verification

Run `python3 tools/live-scroll.py --output <absolute-new-artifact-directory>` on solom-dedi. It acquires Own Chrome before reading settings, uses only its own named pages, restores the original setting, releases Chrome in its final step, and writes `results.json`, decoded raw measurements and `frames.html`. It records screencast frames rather than serial screenshot requests, compresses numeric transport to avoid output truncation, and writes image artifacts through BB's authenticated file API, confined to the requested artifact directory on solom-dedi.

The full run covers all nine scenarios at phone and desktop widths. Both widths share one LONG post for each of the first three stimuli, so the whole run sends at most three posts, only to `thr_yaa3n3kk73`. Their reading points are aligned for those shared stimuli because Chrome emulation uses the same browser storage; reload and two-chat scenarios additionally exercise nonzero signed offsets. Natural Lab activity is observed without posting, with a ten-minute timeout per width and an explicit skip when nothing arrives. A synthetic visibility/focus transition tests background/resume; this is not a native iOS test.

`--preflight` performs post-free reload-position and one-jump checks under the new reload policy. `--only 7` supplies the feature-off comparison. `--only 7` reruns the three feature-on/off timing comparisons without posting. Subset output is labelled separately from a full matrix. The visibility probe checks actual message hit targets and ancestor opacity. Timing additionally checks dark text pixels in the captured chat area, using ImageMagick on solom-dedi, so DOM readiness cannot count a visibly blank compositor frame. Frame timestamps and DOM samples share the browser clock; measurements start at the action trigger. The screenshot classifier excludes the header and composer and retains every decision for inspection. Baseline timings, settling, bottom flashes, image paths and per-scenario offsets are retained for independent inspection.


Verify the installed overlay, native route adapter and server RPC transport in the signed-in BB app with real threads. Preserve raw before/after evidence with the commit.

## Reload: show the host first

Salem chose “Show bb's view at once, then jump” for full reload (thr_exqyeqrqpy, 2026-11-03). On reload, Radar no longer seeds a message fragment at document start. It no longer leaves its generated fragment in the reading URL. Ordinary document navigation retains its early message-route seed. On a navigation classified by the browser as reload, it waits for viewport hit tests to reach native messages, with no loading surface covering them, and two animation frames before asking the native message route to load the saved anchor. BB's initial message-link concealment therefore does not apply. The existing position controller aligns the saved offset when that anchor is ready and cancels on user input. Ordinary navigation and resume retain their existing restore ordering. Explicit links on ordinary navigation remain explicit.

The installed matrix now allows the normal bottom view on reload. It requires no more than 150ms additional blank time versus feature-off, exactly one visible transition to the saved spot, and a final error no greater than 8px. The recorder checks later blank intervals too, rather than only the first visible content. Other transitions retain the no-bottom-flash requirement. Jump counts come from captured compositor frames matched to timestamped anchor geometry, with the raw frames retained.

The user-action scenario also scrolls while a cold reload is still loading the saved older anchor. Radar cancels its owned native message route on takeover before landing, so the host cannot perform its pending jump later. After landing and on ordinary returns, existing scrolling is unchanged.

The recorder retries idempotent CLI operations on a transient disconnected-host error. It never retries a thread post. Warm and cold user-action measurements retain separate geometry; the displayed action frames belong to the cold takeover.

The two-chat fixture switches within the current app document and waits up to nine seconds for each saved anchor to render before checking its independent offset. It does not test an unloaded anchor at an arbitrary fixed delay or reset the app cache by hard-navigating the second chat. The 8px position requirement is unchanged.

Reload first-view timing uses the median of three complete reloads in each mode, retaining every raw sample because native timeline-request latency varies. Every enabled reload must independently request restoration only after hit-testable native content is exposed, record one visible jump, land within 8px and have no later blank exceeding 150ms. The 150ms median extra-blank limit remains. Warm return and resume keep their existing single comparisons.

The recorder retains compositor frames at native cadence for the first six seconds, then samples at 100ms. This avoids missing the first visible frame near the 150ms boundary. Image payloads stay in temporary page memory and upload in bounded batches, avoiding browser storage quotas; the raw originals and timestamps remain in the artifact directory.

Automatic message requests publish a temporary fragment to the native router and clear the browser URL immediately without a second route event. The host continues its request from its captured location while a subsequent reload starts on the normal view. Explicit message links remain persistent. A session marker tracks an unfinished owned request and is removed on landing or cancellation.

An owned native request is cancelled when the user takes over before landing or the recovery deadline expires. The old stored position is retained on timeout; the native loader cannot jump later after Radar has given up.

The natural-activity case resolves Lab's current pinned coordinator from the live bot configuration at run start, so rollover cannot leave it watching a retired chat. If that new chat fits the viewport, the case is explicitly skipped because there is no scrolled-up reading point to preserve. It never sends a message to Lab to create activity.

During recovery, native programmatic scroll events are corrected synchronously before paint. The host emits a scroll event after its message alignment, so its default alignment cannot create a visible second movement after Radar has restored the saved offset. User input ends recovery before its own scroll event.
