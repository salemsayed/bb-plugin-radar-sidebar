import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { NeedsItem } from "./needs";
import { sourceVersion } from "./crewPilotStore";
import { crewWorkSchema, crewRequestSchema, crewCommandSchema, crewControlSchema, reportSchema, organizeSchema, type CrewWork, type CrewRequest, type CrewCommand, type CrewControl } from "./crewContract";
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const stable = (prefix: string, value: unknown) => `${prefix}_${hash(value).slice(0, 24)}`;
const open = (q: CrewRequest) => q.state === "open" || q.state === "answer_queued";
export function createCrewStore(db: Database.Database, now = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS crew_work(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_requests(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_sources(id TEXT PRIMARY KEY, body TEXT NOT NULL, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_source_history(id TEXT NOT NULL, version TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS crew_events(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, work_id TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_outbox(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_cursors(bot TEXT NOT NULL, thread_id TEXT NOT NULL, observed_seq INTEGER NOT NULL, reconciled_seq INTEGER NOT NULL, checked_at INTEGER NOT NULL, user_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bot,thread_id));
    CREATE TABLE IF NOT EXISTS crew_reviews(event_id TEXT PRIMARY KEY, verdict TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS crew_control(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);`);
  // Keep predecessor answer checks through rollover. Upgrade the old one-row-per-bot
  // cursor atomically, preserving its review position and every other Crew table.
  const cursorColumns = db.prepare("PRAGMA table_info(crew_cursors)").all() as { name: string; pk: number }[];
  if (!cursorColumns.some(c => c.name === "thread_id" && c.pk === 2)) db.transaction(() => {
    db.exec(`ALTER TABLE crew_cursors RENAME TO crew_cursors_v1;
      CREATE TABLE crew_cursors(bot TEXT NOT NULL, thread_id TEXT NOT NULL, observed_seq INTEGER NOT NULL, reconciled_seq INTEGER NOT NULL, checked_at INTEGER NOT NULL, user_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bot,thread_id));
      INSERT INTO crew_cursors(bot,thread_id,observed_seq,reconciled_seq,checked_at) SELECT bot,thread_id,observed_seq,reconciled_seq,checked_at FROM crew_cursors_v1;
      DROP TABLE crew_cursors_v1;`);
  }).immediate();
  function rows<T>(table: string, parse: (raw: unknown) => T): T[] { return (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(row => parse(JSON.parse(row.body))); }
  function write(table: "crew_work" | "crew_outbox", row: CrewWork | CrewCommand) { db.prepare(`INSERT INTO ${table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(row.id, JSON.stringify(row)); }
  const saveRequest = (q: CrewRequest) => db.prepare("INSERT INTO crew_requests VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET work_id=excluded.work_id,body=excluded.body").run(q.id, q.workId, JSON.stringify(q));
  const work = () => rows("crew_work", crewWorkSchema.parse);
  const requests = () => rows("crew_requests", crewRequestSchema.parse);
  const commands = () => rows("crew_outbox", crewCommandSchema.parse);
  const getWork = (id: string) => { const found = work().find(w => w.id === id); if (!found) throw new Error("Unknown work record"); return found; };
  const getRequest = (id: string) => { const found = requests().find(q => q.id === id); if (!found) throw new Error("Unknown request"); return found; };
  const control = (): CrewControl => {
    const row = db.prepare("SELECT body FROM crew_control WHERE id=1").get() as { body: string } | undefined;
    return crewControlSchema.parse(row ? JSON.parse(row.body) : {});
  };
  const setControl = (patch: Partial<CrewControl>) => {
    const next = crewControlSchema.parse({ ...control(), ...patch });
    db.prepare("INSERT INTO crew_control VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(next)); return next;
  };
  function event<T>(id: string, payload: unknown, meta: { workId: string; kind: string; actor: string; detail: string }, change: () => T): T | undefined {
    return db.transaction(() => {
      const fingerprint = hash(payload);
      const prior = db.prepare("SELECT fingerprint FROM crew_events WHERE id=?").get(id) as { fingerprint: string } | undefined;
      if (prior) { if (prior.fingerprint !== fingerprint) throw new Error("Event identity conflict"); return undefined; }
      const result = change();
      db.prepare("INSERT INTO crew_events VALUES(?,?,?,?,?,?,?)").run(id, fingerprint, meta.workId, meta.kind, meta.actor, now(), meta.detail);
      return result;
    }).immediate();
  }
  const makeWork = (owner: string, key: string, title: string, origin: CrewWork["origin"], stage: CrewWork["stage"]): CrewWork => ({ id: stable("work", [owner, key]), key, title, owner, origin, stage, revision: 1, createdAt: now(), updatedAt: now(), evidence: null });
  function queue(id: string, w: CrewWork, kind: CrewCommand["kind"], text: string, requestId: string | null = null) {
    const command: CrewCommand = { id: id.length > 200 ? stable("command", id) : id, workId: w.id, requestId, kind, text, state: kind !== "wake" && control().mode === "shadow" ? "proposed" : "queued", requestVersion: requestId ? getRequest(requestId).version : null, recipient: null, baseline: 0, createdAt: now(), receivedAt: null };
    write("crew_outbox", command); return command;
  }
  function sourceUpdates(q: CrewRequest, action: "drop" | "done" | "reopen", eventId: string) {
    const w = getWork(q.workId);
    for (const sourceId of q.sourceIds) {
      const source = sources().find(s => s.id === sourceId); if (!source) continue;
      const target = action === "done" ? "done" : action === "drop" ? "dropped" : "open";
      if (source.state === target) continue;
      queue(`${eventId}:source:${sourceId}`, w, "source_update", JSON.stringify({ id: sourceId, action, version: q.sourceVersions[sourceId] }));
    }
  }
  function sources(): NeedsItem[] { return rows("crew_sources", value => value as NeedsItem); }
  return {
    work, requests, commands, getWork, getRequest, control, setControl, sources,
    automationQuestion(input: { eventId: string; owner: string; automationId: string; reportId: string; sourceThreadId: string; question: string; evidence: string }) {
      const key = stable("automation", [input.automationId, input.reportId]);
      const w = makeWork(input.owner, key, input.question.slice(0, 100), "direct", "blocked");
      const requestId = stable("request", [w.id, "decision"]);
      // Delivery can be retried through a rollover. Its original occurrence,
      // content and ownership are immutable; its current relay thread is not.
      const { sourceThreadId: _relayThread, ...occurrence } = input;
      event(input.eventId, occurrence, { workId: w.id, kind: "automation_question", actor: `${input.owner}:automation`, detail: input.evidence }, () => {
        if (work().some(entry => entry.id === w.id)) throw new Error("Automation occurrence already has another event identity");
        write("crew_work", { ...w, objective: input.evidence, evidence: input.evidence, completionRequired: true });
        saveRequest({ id: requestId, workId: w.id, key: "decision", text: input.question, version: 1, state: "open", placement: "needs_you", due: null, snoozeUntil: null,
          sourceIds: [], sourceVersions: {}, answer: null, evidence: input.evidence, updatedAt: now() });
      });
      return { recorded: true as const, workId: w.id, requestId };
    },
    cursors: () => db.prepare("SELECT bot,thread_id as threadId,observed_seq as observedSeq,reconciled_seq as reconciledSeq,checked_at as checkedAt,user_seq as userSeq FROM crew_cursors").all() as { bot: string; threadId: string; observedSeq: number; reconciledSeq: number; checkedAt: number; userSeq: number }[],
    checkCursor(bot: string, threadId: string, checkedAt: number) {
      db.prepare("INSERT INTO crew_cursors VALUES(?,?,0,0,?,0) ON CONFLICT(bot,thread_id) DO UPDATE SET checked_at=MAX(checked_at,excluded.checked_at)").run(bot, threadId, checkedAt);
    },
    observeCursor(bot: string, threadId: string, seq: number, checkedAt: number, userSeq = 0) {
      db.prepare("INSERT INTO crew_cursors VALUES(?,?,?,0,?,?) ON CONFLICT(bot,thread_id) DO UPDATE SET observed_seq=MAX(observed_seq,excluded.observed_seq),user_seq=MAX(user_seq,excluded.user_seq),checked_at=MAX(checked_at,excluded.checked_at)").run(bot, threadId, seq, checkedAt, userSeq);
    },
    acknowledgeCursor(bot: string, threadId: string, throughSeq: number) {
      const cursor = db.prepare("SELECT observed_seq FROM crew_cursors WHERE bot=? AND thread_id=?").get(bot, threadId) as { observed_seq: number } | undefined;
      if (!cursor || throughSeq > cursor.observed_seq) throw new Error("Unknown or stale history cursor");
      db.prepare("UPDATE crew_cursors SET reconciled_seq=MAX(reconciled_seq,?) WHERE bot=? AND thread_id=?").run(throughSeq, bot, threadId);
    },
    syncClosedSources() {
      for (const q of requests()) if (["answered", "withdrawn", "dismissed"].includes(q.state) && q.evidence) {
        const id = `sync:${q.id}:${q.version}`;
        event(id, q, { workId: q.workId, kind: "source_sync", actor: "reviewed-history", detail: "Sync confirmed historical closure" }, () => sourceUpdates(q, q.state === "answered" ? "done" : "drop", id));
      }
    },
    reviews: () => db.prepare("SELECT event_id as eventId,verdict,at FROM crew_reviews").all() as { eventId: string; verdict: "correct" | "incorrect"; at: number }[],
    review(eventId: string, verdict: "correct" | "incorrect") {
      const found = db.prepare("SELECT kind,actor FROM crew_events WHERE id=?").get(eventId) as { kind: string; actor: string } | undefined;
      if (!found || ["source"].includes(found.kind) || found.actor === "reviewed-history") throw new Error("Review an actual coordinator or bot transition, not an imported fixture");
      db.prepare("INSERT INTO crew_reviews VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET verdict=excluded.verdict,at=excluded.at").run(eventId, verdict, now());
    },
    events: () => (db.prepare("SELECT id,work_id as workId,kind,actor,at,detail FROM crew_events ORDER BY rowid DESC LIMIT 300").all() as { id: string; workId: string; kind: string; actor: string; at: number; detail: string }[]),
    saveCommand(command: CrewCommand) { write("crew_outbox", crewCommandSchema.parse(command)); },
    ingest(items: NeedsItem[]) {
      for (const item of items) {
        const version = sourceVersion(item);
        event(`source:${item.id}:${version}`, item, { workId: stable("work", [item.bot, item.id]), kind: "source", actor: item.bot, detail: item.text }, () => {
          db.prepare("INSERT OR IGNORE INTO crew_source_history VALUES(?,?,?)").run(item.id, version, JSON.stringify(item));
          db.prepare("INSERT INTO crew_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=excluded.version").run(item.id, JSON.stringify(item), version);
          const known = requests().find(q => q.sourceIds.includes(item.id));
          if (known) {
            // Reminder counters are delivery bookkeeping, not a new occurrence. Explicit reopen has a changed terminal state.
            const old = known.sourceVersions[item.id];
            if (old === version) return;
            const isTerminal = item.state === "done" || item.state === "dropped";
            const oldSource = db.prepare("SELECT body FROM crew_source_history WHERE id=? AND version=?").get(item.id, old) as { body: string } | undefined;
            const previous = oldSource ? JSON.parse(oldSource.body) as NeedsItem : null;
            const oldState = previous?.state ?? null;
            const reopened = ["done", "dropped"].includes(oldState ?? "") && !isTerminal;
            const semanticChange = !previous || previous.text !== item.text || previous.due !== item.due || previous.snoozeUntil !== item.snoozeUntil || ((["done", "dropped"].includes(previous.state)) !== isTerminal);
            const allTerminal = known.sourceIds.every(id => sources().some(s => s.id === id && ["done", "dropped"].includes(s.state)));
            saveRequest({ ...known, text: known.sourceIds.length === 1 ? item.text : known.text, version: known.version + (semanticChange ? 1 : 0),
              state: reopened ? "open" : allTerminal && known.state === "open" ? (item.state === "done" ? "answered" : "dismissed") : known.state,
              due: item.due, snoozeUntil: item.snoozeUntil, sourceVersions: { ...known.sourceVersions, [item.id]: version }, updatedAt: now() });
            return;
          }
          const w = makeWork(item.bot, item.id, item.text.slice(0, 150), "legacy", "unknown"); write("crew_work", w);
          saveRequest({ id: stable("request", [item.bot, item.id]), workId: w.id, key: item.id, text: item.text, version: 1,
            state: item.state === "done" ? "answered" : item.state === "dropped" ? "dismissed" : "open",
            placement: ["reminder", "deadline"].includes(item.kind) ? "reminders" : item.state === "snoozed" ? "later" : "needs_you",
            due: item.due, snoozeUntil: item.snoozeUntil, sourceIds: [item.id], sourceVersions: { [item.id]: version }, answer: null, evidence: null, updatedAt: now() });
        });
      }
    },
    organize(raw: z.infer<typeof organizeSchema>, actor: string, trustedMigration = false) {
      const input = organizeSchema.parse(raw);
      const items = input.sourceIds.map(id => { const found = sources().find(s => s.id === id); if (!found || input.sourceVersions[id] !== sourceVersion(found)) throw new Error("Source changed; refresh before organizing"); return found; });
      const owner = items[0]!.bot;
      if (items.some(i => i.bot !== owner)) throw new Error("A request cannot cross bot ownership");
      if (items.some(i => i.due || i.kind === "reminder" || i.kind === "deadline") && (input.state !== "open" || input.placement !== "reminders") && !trustedMigration) throw new Error("Preserve reminders until Salem confirms them");
      const w = makeWork(owner, input.workKey, input.title, "legacy", "unknown");
      event(input.eventId, { input, actor }, { workId: w.id, kind: "organize", actor, detail: input.evidence }, () => {
        const oldRequests = requests().filter(q => q.sourceIds.some(id => input.sourceIds.includes(id)));
        if (oldRequests.some(q => q.sourceIds.some(id => !input.sourceIds.includes(id)))) throw new Error("Include every source of the existing request before moving it");
        const currentWork = work().find(entry => entry.id === w.id);
        write("crew_work", currentWork ? { ...currentWork, title: input.title, revision: currentWork.revision + 1, updatedAt: now() } : w);
        const rid = stable("request", [w.id, input.requestKey]);
        const existing = requests().find(q => q.id === rid);
        const sourceIds = [...new Set([...(existing?.sourceIds ?? []), ...input.sourceIds])];
        const sourcesById = Object.fromEntries(sourceIds.map(id => [id, sourceVersion(sources().find(s => s.id === id)!)]));
        if (existing && !open(existing) && input.state === "open") throw new Error("A closed occurrence cannot reopen through another report");
        const q: CrewRequest = { id: rid, workId: w.id, key: input.requestKey, text: items.at(-1)!.text, version: (existing?.version ?? 0) + 1,
          state: input.state, placement: input.placement, due: items[0]!.due, snoozeUntil: items[0]!.snoozeUntil, sourceIds, sourceVersions: sourcesById, answer: existing?.answer ?? null, evidence: input.evidence, updatedAt: now() };
        for (const old of oldRequests) if (old.id !== rid) db.prepare("DELETE FROM crew_requests WHERE id=?").run(old.id);
        saveRequest(q);
        if (input.remaining) {
          if (input.state === "open" || input.remaining.key === input.requestKey) throw new Error("A residual request needs a closed original and its own identity");
          const id = stable("request", [w.id, input.remaining.key]);
          const previous = requests().find(r => r.id === id);
          if (previous && previous.state !== "open") throw new Error("Do not revive an already handled residual request");
          saveRequest({ id, workId: w.id, key: input.remaining.key, text: input.remaining.text, placement: input.remaining.placement, state: "open", version: (previous?.version ?? 0) + 1, due: null, snoozeUntil: null, sourceIds: [], sourceVersions: {}, answer: null, evidence: input.evidence, updatedAt: now() });
        }
        if (input.state !== "open") sourceUpdates(q, input.state === "answered" ? "done" : "drop", input.eventId);
        for (const old of oldRequests) if (old.workId !== w.id && !requests().some(q => q.workId === old.workId)) db.prepare("DELETE FROM crew_work WHERE id=?").run(old.workId);
      });
      return w.id;
    },
    assign(input: { eventId: string; owner: string; key: string; title: string; objective: string; origin: "crew" | "direct"; actor: string; authorization?: CrewWork["authorization"] }) {
      const w = { ...makeWork(input.owner, input.key, input.title, input.origin, input.origin === "direct" ? "active" : control().mode === "shadow" ? "proposed" : "queued"), objective: input.objective, authorization: input.authorization, completionRequired: true };
      event(input.eventId, input, { workId: w.id, kind: "assign", actor: input.actor, detail: input.objective }, () => {
        if (work().some(entry => entry.id === w.id)) throw new Error("Use the existing work record");
        write("crew_work", w);
        if (input.origin === "crew") queue(input.eventId, w, "assign", input.objective);
      });
      return getWork(w.id);
    },
    followup(input: { eventId: string; workId: string; expectedRevision: number; text: string; actor: string }) {
      const w = getWork(input.workId);
      event(input.eventId, input, { workId: w.id, kind: "followup", actor: input.actor, detail: input.text }, () => {
        if (w.revision !== input.expectedRevision || ["done", "canceled", "stopping"].includes(w.stage)) throw new Error("Work changed, stopped or finished");
        queue(input.eventId, w, "followup", input.text);
        write("crew_work", { ...w, revision: w.revision + 1, updatedAt: now() });
      });
    },
    userRequest(input: { commandId: string; requestId: string; expectedVersion: number; action: "answer" | "later" | "dismiss" | "reopen"; text?: string }) {
      const q = getRequest(input.requestId); const w = getWork(q.workId);
      event(input.commandId, input, { workId: w.id, kind: input.action, actor: "salem", detail: input.text ?? input.action }, () => {
        if (q.version !== input.expectedVersion) throw new Error("Request changed; use its current version");
        if (input.action !== "reopen" && !open(q)) throw new Error("This request is already closed");
        if (input.action === "answer" && (!input.text?.trim() || q.state !== "open")) throw new Error("An open question and an exact answer are required");
        saveRequest({ ...q, version: q.version + 1, state: input.action === "answer" ? "answer_queued" : input.action === "dismiss" ? "dismissed" : input.action === "reopen" ? "open" : q.state,
          placement: input.action === "later" ? "later" : q.placement, answer: input.action === "answer" ? input.text! : q.answer, updatedAt: now() });
        if (input.action === "dismiss" || input.action === "reopen") sourceUpdates(q, input.action === "dismiss" ? "drop" : "reopen", input.commandId);
        if (input.action === "answer") queue(input.commandId, w, "answer", input.text!, q.id);
      });
    },
    proposal(input: { commandId: string; proposalId: string; action: "send" | "discard" }) {
      const command = commands().find(c => c.id === input.proposalId); if (!command) throw new Error("Unknown proposal");
      const w = getWork(command.workId);
      event(input.commandId, input, { workId: w.id, kind: "proposal", actor: "salem", detail: input.action }, () => {
        if (command.state !== "proposed") throw new Error("This proposal was already handled");
        if (input.action === "send" && control().mode !== "live") throw new Error("Enable live mode before dispatching");
        const q = command.requestId ? getRequest(command.requestId) : null;
        if (input.action === "send" && q && (q.version !== command.requestVersion || q.state !== "answer_queued")) throw new Error("Proposal refers to an obsolete request version");
        if (input.action === "send" && command.kind === "assign" && w.stage !== "proposed") throw new Error("Work is no longer awaiting assignment");
        write("crew_outbox", { ...command, state: input.action === "send" ? "queued" : "obsolete" });
        if (command.kind === "assign") write("crew_work", { ...w, stage: input.action === "send" ? "queued" : "canceled", revision: w.revision + 1, updatedAt: now() });
        if (input.action === "discard" && q && q.state === "answer_queued" && q.version === command.requestVersion) saveRequest({ ...q, state: "open", answer: null, version: q.version + 1, updatedAt: now() });
      });
    },
    cancel(input: { commandId: string; workId: string; expectedRevision: number }) {
      const w = getWork(input.workId);
      event(input.commandId, input, { workId: w.id, kind: "cancel", actor: "salem", detail: "Stop requested" }, () => {
        if (w.revision !== input.expectedRevision || ["done", "canceled"].includes(w.stage)) throw new Error("Work changed or is already finished");
        write("crew_work", { ...w, stage: "stopping", revision: w.revision + 1, updatedAt: now() });
        queue(input.commandId, w, "cancel", "Salem requests cancellation. Stop safely and report cancel_ack when stopped.");
      });
    },
    report(raw: z.infer<typeof reportSchema>, owner: string) {
      const i = reportSchema.parse(raw); const w = getWork(i.workId);
      if (w.owner !== owner) throw new Error("Only the owning bot can report this work");
      event(i.eventId, { i, owner }, { workId: w.id, kind: i.kind, actor: owner, detail: i.evidence }, () => {
        if (w.revision !== i.expectedRevision) throw new Error("Stale work revision");
        if (["done", "canceled"].includes(w.stage)) throw new Error("Work is terminal; a new task needs a new identity");
        let stage = w.stage;
        if (i.kind === "accepted") stage = "active";
        if (i.kind === "progress") stage = "active";
        if (i.kind === "blocked") stage = "blocked";
        if (i.kind === "completed") {
          if (requests().some(q => q.workId === w.id && open(q))) throw new Error("Resolve outstanding requests before completion");
          if (w.completionRequired && (!i.checks || Object.values(i.checks).some(c => c.status === "failed"))) throw new Error("Completion requires delivery, verification and cleanup evidence, with no failed checks");
          stage = "done";
        }
        if (i.kind === "cancel_ack") { if (w.stage !== "stopping") throw new Error("No cancellation pending"); stage = "canceled"; }
        if (w.stage === "stopping" && !["cancel_ack", "question", "withdraw", "ack_answer", "direct_answer"].includes(i.kind)) throw new Error("A stop acknowledgment is required");
        if (i.kind === "question") {
          if (!i.requestKey || !i.text) throw new Error("Question identity and text are required");
          const rid = stable("request", [w.id, i.requestKey]); const q = requests().find(q => q.id === rid);
          if (q && (q.state !== "open" || i.expectedVersion !== q.version)) throw new Error("Request is closed or its version changed");
          saveRequest({ id: rid, workId: w.id, key: i.requestKey, text: i.text, version: (q?.version ?? 0) + 1, state: "open", placement: i.placement ?? "needs_you",
            due: q?.due ?? null, snoozeUntil: q?.snoozeUntil ?? null, sourceIds: q?.sourceIds ?? [], sourceVersions: q?.sourceVersions ?? {}, answer: q?.answer ?? null, evidence: i.evidence, updatedAt: now() });
        }
        if (i.kind === "ack_answer" || i.kind === "direct_answer" || i.kind === "withdraw") {
          const q = getRequest(i.requestId ?? "");
          if (q.workId !== w.id || q.version !== i.expectedVersion) throw new Error("Wrong or stale request");
          if (i.kind === "ack_answer" && q.state !== "answer_queued") throw new Error("No queued answer to acknowledge");
          if (!open(q)) throw new Error("Request is already closed");
          sourceUpdates(q, i.kind === "withdraw" ? "drop" : "done", i.eventId);
          saveRequest({ ...q, state: i.kind === "withdraw" ? "withdrawn" : "answered", answer: i.kind === "direct_answer" ? i.text! : q.answer, version: q.version + 1, evidence: i.evidence, updatedAt: now() });
        }
        write("crew_work", crewWorkSchema.parse({ ...w, stage, revision: w.revision + 1, evidence: i.evidence, updatedAt: now(), checks: i.checks ?? w.checks,
          workerIds: [...new Set([...(w.workerIds ?? []), ...(i.workerIds ?? [])])] }));
        if (w.origin === "crew" && ["question", "blocked", "completed", "cancel_ack"].includes(i.kind)) queue(`wake:${i.eventId}`, w, "wake", i.evidence);
      });
      return getWork(w.id);
    },
  };
}
export type CrewStore = ReturnType<typeof createCrewStore>;
