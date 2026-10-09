# Crew coordinator

Crew opens a quiet overview: Needs your answer, live Bot activity, then compact
Reminders. Later is collapsed; Chat and History are secondary views on desktop and
mobile. The native coordinator ThreadChat opens only when Chat is selected. Settings,
tracked assignments and delivery audit remain available under Settings & activity log.
With the bot rail enabled, one Crew entry sits above the specialist bots; the generic
duplicate is suppressed. ChatGPT dots and voice integrations are excluded.

Activity reads BB's live sidebar cache and the registered bot lineage, including
running hidden automation children and workers retained across rollover. It does not
require a Crew assignment or infer work from imported records, project membership or
conversation prose. Pending approvals link to the affected thread. Idle bots remain
compact links; unavailable activity never becomes an All quiet claim. Reading the
overview creates no request, command or model call.

The installed coordinator is live and unpaused at Salem's request. The mode control
can return to shadow; Pause stops automatic delivery and new manager mutations.
It does not terminate running specialist work. Request stop sends a cancellation;
work stays Stopping until its owning bot acknowledges it.

## State and ownership

SQLite `crew_*` tables retain work, independently versioned requests, source history,
immutable event identities, reviews, dispatch receipts and coordinator identity.
The original `crew_pilot_*` experiment is retained separately for its audit history.

Owners are stable bot keys; dispatch resolves the current coordinator once and pins
that recipient before sending. Replies bind a request/version and stay pending until
an acknowledgment. A direct bot chat can adopt work without dispatch and report its
answer with the exact user-event sequence. Tool execution checks current bot ownership.
Progress cannot overwrite a newer revision, close unresolved requests, or revive a
finished task. Repeated event IDs are idempotent; conflicting payloads fail.

Source imports preserve dates, snoozes and old evidence. The reviewed-history importer
only applies exact source-version matches and skips changed records. Closed occurrences
do not reopen from reminder counters; explicit reopen remains possible. Confirmed
closures can sync to the original needs store. User dismissal stops original reminders
through the same durable delivery queue. Later changes placement, not the reminder time.

## Delivery and recovery

Assignments, follow-ups, answers, cancellation, notifications and source updates use a
persistent outbox. A failed or interrupted send is reconciled against the original
recipient's event history. An uncertain send is never blindly retried or redirected
after bot rollover. The page exposes uncertain delivery and a receipt check.

Shadow proposals do not automatically become live commands when mode changes. Each
proposal can be explicitly sent or discarded. Routine progress, source imports and
standalone questions update the page without waking Crew. Bots continue owning their
work. Crew wakes for Salem's own conversation, important reports on work explicitly
assigned through Crew (questions, blockers, completion or cancellation acknowledgment),
and a real human reply that may answer an existing request. Multiple pending relevant
wakes collapse into one review. Source snapshots refresh on bot idle and every
30 seconds without a model call.

Reload preserves all records. Crew is registered as bot key `crew` with bb-salem-bots,
in its own Crew Bot project/workspace. The normal bot lifecycle owns automatic context
rollover, handoff files, startup verification, predecessor archival and child-result
forwarding. Radar follows `bot_roster.current`, keeps the manager hidden from Home and
ordinary thread lists, and holds dispatch while the destination is handing off.
Use `bb saelmbot rollover now --bot crew` for a manual rollover, not an independent spawn.

Durable observed/reconciled event cursors are keyed by bot and conversation, so
predecessor answers survive rollover, reload and offline gaps. Bot-idle and catch-up
checks require a real human message after an open request appeared, followed by an
owning coordinator reply and a settled conversation. Automation notices, worker/tool
chatter and bot replies on their own do not trigger a model review. Coalesced wakes
retain pending human-answer cursors; Crew acknowledges each only after checking its
requests. Reviews check the cited answer without relaying unrelated bot findings.
History tools return real user/assistant messages with exact sequence references, not
worker/tool chatter. Closures read the exact cited events across arbitrarily long tool
runs. A partially answered question can close while a separate, clearly worded residual
request remains open. These model judgments retain evidence and can be reopened.

Native ThreadChat retains BB's ordinary tools and permission behavior. Manager
instructions require Crew's coordination tools; this is not a provider sandbox.

## Tools and commands

Manager tools: `crew_read`, `crew_history`, `crew_assign`, `crew_answer`,
`crew_followup`, `crew_request_action`, `crew_cancel`, `crew_organize`.
Manager also uses `crew_reconciled` to acknowledge reviewed history cursors.
Bot tools: `crew_read`, `crew_history` (own registered lineage), `crew_assign` (adopt direct work), `crew_report`.

New work retains its objective and the original user-event authorization through
rollover. Manager assignments require real human input; an owning bot can record
existing automated work without inventing authorization or redispatching it. Completion
requires delivery, verification and cleanup evidence (or an explained not_applicable).
Tracked worker IDs accumulate across reports; active, queued or question-pending
workers prevent completion and cancellation acknowledgment. Direct answers may cite a
registered predecessor, but cannot bind unrelated bot history.

Automation decisions use an authenticated plugin RPC to atomically persist one work
record and question before relay/archive. Persistence continues while dispatch is
paused. The source report outbox retries unavailable writes with the same occurrence
ID. Exact legacy decision mappings preserve old state across producer upgrades. Reads
and sidebar renders no longer create questions through sentence extraction or Jev.
Historical source ingestion and explicit reminders remain supported.

Answer reconciliation has three automatic attempts per human reply, at least five
minutes apart, retained across reload. Later automated bot replies do not reset that
budget. A new human reply or explicit `bb crew reconcile` permits another check.
The board exposes exhausted review. A queued old routine wake becomes obsolete on
upgrade; stored requests and pinned sending/uncertain receipts remain intact. This
bounds retries without claiming that model judgments are always correct.

An older provider session can use the same authenticated handlers through:

```
bb crew tools --json
bb crew tool --name crew_read --input '{}'
bb crew status --json
bb crew control --mode live --paused no --json
bb crew setup --thread <base-thread-id> --json
bb saelmbot rollover status --bot crew --json
bb saelmbot rollover now --bot crew --json
bb crew reconcile --json
bb crew probe --json
bb crew sync-closed --json
```

`probe` delivers a no-work notification to Crew itself, never a specialist.
`import-reviewed --manifest '<JSON>'` previews a reviewed manifest; `--apply` applies
exact matches. Manifest content is supplied explicitly, not read from an assumed host
path. Review Correct/Incorrect remains available for operational auditing and does not
block live mode. Personal history is kept in the plugin database, not bundled in source.

## Validation

Tests exercise actual SQLite transitions and fake-host integration: ownership, source
version checks, independent questions, direct answers, explicit reopen, cancellation,
proposal activation, source closure, pause, live dispatch, immutable recipient recovery,
and no duplicate send after a lost acknowledgment. UI tests check bound replies,
source outages and the singleton Crew navigation entry. Live verification covers the native
coordinator, real outbox receipt, historical source updates, registered-bot rollover/handoff, reload persistence, and
rendered desktop/mobile Overview, Chat and History. These tests are not an exhaustive guarantee of
future model interpretation, and no specialist project work is used as a test payload.
