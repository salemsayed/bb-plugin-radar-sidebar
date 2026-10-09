import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ThreadChat, experimental_useSidebarThreads, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { crewContract, type CrewBoard, type CrewRequest } from "@/lib/crewContract";
import { BotFace } from "./BotFace";
import { shortBotName } from "./bots";
import { rosterRefreshKey } from "./botScope";
import { crewActivity, type CrewActivityState } from "./crewActivity";
import { useBotRoster } from "./useBotRoster";

const views = ["overview", "chat", "history"] as const;
const viewLabels = { overview: "Overview", chat: "Chat", history: "History" };
const activityLabels: Record<CrewActivityState, string> = {
  failed: "Last turn failed", working: "Working", queued: "Queued", waiting: "Waiting for machine",
  handover: "Handing over", unavailable: "Unavailable", idle: "Quiet",
};
const isOpen = (q: CrewRequest) => q.state === "open" || q.state === "answer_queued";

export function CrewWorkspace() {
  const rpc = useRpc<typeof crewContract>();
  const navigate = useBbNavigate();
  const sidebar = experimental_useSidebarThreads();
  const roster = useBotRoster(true, rosterRefreshKey(sidebar.threads));
  const [board, setBoard] = useState<CrewBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<typeof views[number]>("overview");
  const [bot, setBot] = useState("all");
  const [selected, setSelected] = useState<CrewRequest | null>(null);
  const [text, setText] = useState("");
  const alive = useRef(true);
  const reads = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const n = ++reads.current;
    try {
      const result = await rpc.call(refresh ? "crew_refresh" : "crew_board", {});
      if (alive.current && n === reads.current) { setBoard(result); setReadError(null); }
    } catch (e) {
      if (refresh) throw e;
      if (alive.current && n === reads.current) setReadError(e instanceof Error ? e.message : String(e));
    }
  }, [rpc]);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const requestAction = (q: CrewRequest, action: "answer" | "later" | "dismiss" | "reopen", answer?: string) => act(async () => {
    await rpc.call("crew_user_request", { commandId: crypto.randomUUID(), requestId: q.id, expectedVersion: q.version, action, ...(answer ? { text: answer } : {}) });
    setSelected(null); setText("");
  });
  const requests = board?.requests ?? [];
  const work = board?.work ?? [];
  const bots = board?.bots ?? [];
  const ownerOf = (q: CrewRequest) => work.find(w => w.id === q.workId)?.owner;
  const owned = (q: CrewRequest) => bot === "all" || ownerOf(q) === bot;
  const inLane = (lane: CrewRequest["placement"]) => requests.filter(q => isOpen(q) && q.placement === lane && owned(q));
  const needs = inLane("needs_you");
  const reminders = inLane("reminders");
  const later = inLane("later");
  const history = requests.filter(q => !isOpen(q) && owned(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  // The durable board supplies the current pointer while the roster refresh catches up to rollover.
  const activity = crewActivity(roster.map(b => ({ ...b, current: bots.find(current => current.key === b.key)?.current ?? b.current })), sidebar.threads)
    .filter(row => bot === "all" || row.bot.key === bot);
  const moving = activity.filter(row => row.state !== "idle");
  const pending = activity.flatMap(row => row.pending.map(thread => ({ bot: row.bot, thread })));
  const quiet = activity.filter(row => row.state === "idle" && !row.pending.length);
  const activityReady = sidebar.status === "ready" && roster.length > 0;
  const activeWork = work.filter(w => !["done", "canceled", "unknown"].includes(w.stage) && (bot === "all" || w.owner === bot));

  const requestCard = (q: CrewRequest, compact = false) => {
    const owner = ownerOf(q) ?? "unknown";
    const ownerBot = bots.find(b => b.key === owner);
    const title = work.find(w => w.id === q.workId)?.title;
    const ownerLabel = <span className="crew-card-owner"><BotFace botKey={owner} name={ownerBot?.name ?? owner} size={14} /><strong>{shortBotName(ownerBot?.name ?? owner)}</strong></span>;
    const content = <>
      {!compact && ownerLabel}
      {!compact && title && title !== q.text && <h3 className="crew-work-title">{title}</h3>}
      <p className="crew-request-text">{q.text}</p>
      {q.state === "answer_queued" && <p className="crew-date">{board?.control.mode === "shadow" ? "Reply proposed" : "Reply sent, awaiting acknowledgment"}: {q.answer}</p>}
      {q.due && <p className="crew-date">Due {q.due}</p>}
      {q.snoozeUntil && <p className="crew-date">Snoozed until {q.snoozeUntil}</p>}
      <div className="crew-card-actions">
        {q.state === "open" && <button className="crew-button crew-primary" disabled={busy} onClick={() => { setSelected(q); setText(""); }}>Reply</button>}
        {isOpen(q) ? <>
          {q.placement !== "later" && <button className="crew-button" disabled={busy} onClick={() => void requestAction(q, "later")}>Later</button>}
          <button className="crew-button" disabled={busy} onClick={() => void requestAction(q, "dismiss")}>Dismiss</button>
        </> : <button className="crew-button" disabled={busy} onClick={() => void requestAction(q, "reopen")}>Reopen</button>}
        {ownerBot && <button className="crew-button crew-link-button" onClick={() => navigate.toThread(ownerBot.current)}>Open bot</button>}
      </div>
      <details className="crew-evidence"><summary>Why this is here</summary>
        <p>{q.evidence ?? "Saved request from the owning bot."}</p>
        {!isOpen(q) && q.answer && <p>Answer: {q.answer}</p>}
        {q.sourceIds.map(id => { const s = board?.sources.find(s => s.id === id); return s?.source.threadId ? <button key={id} className="crew-button" onClick={() => navigate.toThread(s.source.threadId!)}>{s.text.slice(0, 55)}</button> : null; })}
      </details>
    </>;
    return compact ? <details className="crew-compact-request" key={q.id}>
      <summary>{ownerLabel}<span className="crew-compact-text">{q.text}</span>{q.due && <span className="crew-date">{q.due}</span>}{q.state === "answer_queued" && <span className="crew-date">Reply pending</span>}{!isOpen(q) && <span className="crew-date">{q.state === "answered" ? "Answered" : q.state === "dismissed" ? "Dismissed" : "Withdrawn"}</span>}</summary>
      <div className="crew-compact-body">{content}</div>
    </details> : <article className="crew-work-card" key={q.id}>{content}</article>;
  };

  return <div className="crew-workspace">
    <header className="crew-workspace-header">
      <div><h1>Crew</h1><p>Your bots, at a glance.</p></div>
      <nav className="crew-view-tabs" aria-label="Crew views">{views.map(value => <button key={value} aria-current={view === value ? "page" : undefined} onClick={() => setView(value)}>{viewLabels[value]}</button>)}</nav>
    </header>
    {board && (board.control.paused || board.control.mode === "shadow") && <p className="crew-mode-notice">{board.control.paused ? "Coordination is paused. Your requests are saved." : "Shadow mode: replies are saved as proposals."}</p>}
    {(error || readError || board?.warning) && <div className="crew-error" role="alert">{error ?? readError ?? board?.warning}</div>}
    {view === "chat" ? <section className="crew-chat-pane" aria-label="Coordinator chat">
      {board?.control.coordinator ? <div className="crew-native-chat"><ThreadChat threadId={board.control.coordinator} variant="full" layout="contained" permissionPolicy="inherit" /></div> : <div className="crew-chat-welcome"><h2>Your coordinator</h2><p>The Crew Bot is unavailable.</p><button className="crew-button" disabled={busy} onClick={() => void act(() => load(true))}>Reconnect</button></div>}
    </section> : <div className="crew-overview-scroll"><main className="crew-overview">
      <label className="crew-owner-filter">Show<select aria-label="Filter by bot" value={bot} onChange={e => setBot(e.target.value)}><option value="all">All bots</option>{bots.map(b => <option key={b.key} value={b.key}>{b.name}</option>)}</select></label>
      {!board ? <p className="crew-empty" role="status">Loading Crew…</p> : view === "history" ? <section aria-labelledby="crew-history-title">
        <div className="crew-section-title"><h2 id="crew-history-title">History</h2><span>{history.length}</span></div>
        <div className="crew-compact-list">{history.map(q => requestCard(q, true))}</div>
        {!history.length && <p className="crew-empty">No past requests.</p>}
      </section> : <>
        <section aria-labelledby="crew-needs-title">
          <div className="crew-section-title"><h2 id="crew-needs-title">Needs your answer</h2>{!!(needs.length + pending.length) && <span>{needs.length + pending.length}</span>}</div>
          <div className="crew-cards">{needs.map(q => requestCard(q))}{pending.map(({ bot: owner, thread }) => <article className="crew-work-card" key={thread.id}>
            <div className="crew-card-owner"><BotFace botKey={owner.key} name={owner.name} size={14} /><strong>{shortBotName(owner.name)}</strong></div>
            <p className="crew-request-text">{thread.id === owner.current ? "Your bot needs input or approval." : thread.displayTitle}</p>
            <button className="crew-button crew-primary" onClick={() => navigate.toThread(thread.id)}>Review request</button>
          </article>)}</div>
          {!needs.length && !pending.length && <p className="crew-calm">Nothing needs your answer{activityReady ? "." : " in saved requests."}</p>}
        </section>
        <section aria-labelledby="crew-activity-title">
          <div className="crew-section-title"><h2 id="crew-activity-title">Bot activity</h2>{!!moving.length && <span>{moving.length}</span>}</div>
          {!activityReady && <p className="crew-activity-warning" role="status">{sidebar.status === "loading" ? "Loading live bot activity…" : "Live bot activity is unavailable. Saved requests are still shown."}</p>}
          <div className="crew-activity-list">{moving.map(row => <button className={`crew-activity-row crew-activity-${row.state}`} key={row.bot.key} onClick={() => navigate.toThread(row.threadId)} aria-label={`${row.bot.name}, ${activityLabels[row.state]}: ${row.text}`}>
            <span className="crew-bot-face" aria-hidden="true"><BotFace botKey={row.bot.key} name={row.bot.name} size={24} /></span>
            <span className="crew-activity-copy"><span className="crew-activity-heading"><strong>{shortBotName(row.bot.name)}</strong><span className="crew-activity-state">{activityLabels[row.state]}{row.workers > 0 ? ` · ${row.workers} worker${row.workers === 1 ? "" : "s"}` : ""}</span></span><span className="crew-activity-text">{row.text}{row.more ? ` · ${row.more} more` : ""}</span></span><span aria-hidden="true">›</span>
          </button>)}</div>
          {activityReady && !moving.length && <p className="crew-calm">{pending.length ? "Bots are waiting for your input above." : "All bots are quiet."}</p>}
          {!!quiet.length && <div className="crew-quiet-bots"><span>Quiet</span>{quiet.map(row => <button key={row.bot.key} onClick={() => navigate.toThread(row.bot.current)}>{shortBotName(row.bot.name)}</button>)}</div>}
          {!roster.length && <div className="crew-quiet-bots">{bots.map(b => <button key={b.key} onClick={() => navigate.toThread(b.current)}>{shortBotName(b.name)}</button>)}</div>}
        </section>
        <section aria-labelledby="crew-reminders-title">
          <div className="crew-section-title"><h2 id="crew-reminders-title">Reminders</h2>{!!reminders.length && <span>{reminders.length}</span>}</div>
          <div className="crew-compact-list">{reminders.map(q => requestCard(q, true))}</div>
          {!reminders.length && <p className="crew-calm">No reminders.</p>}
        </section>
        {!!later.length && <details className="crew-later"><summary>Later <span>{later.length}</span></summary><div className="crew-compact-list">{later.map(q => requestCard(q, true))}</div></details>}
      </>}
      <details className="crew-settings"><summary>Settings & activity log</summary>
        <div className="crew-card-actions"><button className="crew-button" disabled={busy} onClick={() => void act(() => load(true))}>Refresh sources</button>
          <button className="crew-button" disabled={busy || !board} onClick={() => void act(() => rpc.call("crew_control", { paused: !board?.control.paused }))}>{board?.control.paused ? "Resume coordination" : "Pause coordination"}</button>
          <button className="crew-button" disabled={busy || !board} onClick={() => void act(() => rpc.call("crew_control", { mode: board?.control.mode === "live" ? "shadow" : "live" }))}>{board?.control.mode === "live" ? "Return to shadow" : "Enable live coordination"}</button></div>
        {!!activeWork.length && <details><summary>Tracked assignments · {activeWork.length}</summary>{activeWork.map(w => <div className="crew-work-card" key={w.id}><strong>{w.title}</strong><p>{w.owner} · {w.stage}</p>{w.evidence && <p>{w.evidence}</p>}<button className="crew-button" disabled={busy || w.stage === "stopping"} onClick={() => void act(() => rpc.call("crew_user_cancel", { commandId: crypto.randomUUID(), workId: w.id, expectedRevision: w.revision }))}>{w.stage === "stopping" ? "Stopping" : "Request stop"}</button></div>)}</details>}
        <details><summary>Dispatches & audit · {board?.commands.length ?? 0}</summary>
          {board?.commands.map(c => <div key={c.id} className="crew-work-card"><strong>{c.kind} · {c.state}</strong><p>{c.text}</p>{c.state === "proposed" && <div className="crew-card-actions"><button className="crew-button" disabled={busy || board.control.mode !== "live"} onClick={() => void act(() => rpc.call("crew_proposal", { commandId: crypto.randomUUID(), proposalId: c.id, action: "send" }))}>Send proposal</button><button className="crew-button" disabled={busy} onClick={() => void act(() => rpc.call("crew_proposal", { commandId: crypto.randomUUID(), proposalId: c.id, action: "discard" }))}>Discard proposal</button></div>}{["sending", "uncertain"].includes(c.state) && <button className="crew-button" disabled={busy} onClick={() => void act(() => rpc.call("crew_reconcile", { commandId: c.id }))}>Check original recipient</button>}</div>)}
          {board?.events.filter(e => e.kind !== "source" && e.actor !== "reviewed-history").slice(0, 30).map(e => <div key={e.id}><p>{e.actor} · {e.kind} · {e.detail}</p><span>{board.reviews.find(r => r.eventId === e.id)?.verdict ?? "Unreviewed"}</span><button className="crew-button" disabled={busy} onClick={() => void act(() => rpc.call("crew_review", { eventId: e.id, verdict: "correct" }))}>Correct</button><button className="crew-button" disabled={busy} onClick={() => void act(() => rpc.call("crew_review", { eventId: e.id, verdict: "incorrect" }))}>Incorrect</button></div>)}
        </details>
      </details>
    </main></div>}
    <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <Dialog.Portal><Dialog.Overlay className="crew-reply-overlay" /><Dialog.Content className="crew-reply-dialog">
        <form onSubmit={e => { e.preventDefault(); if (selected && text.trim()) void requestAction(selected, "answer", text.trim()); }}>
          <Dialog.Title>Reply to this request</Dialog.Title><Dialog.Description>{selected?.text}</Dialog.Description>
          <label>Exact answer<textarea aria-label="Exact answer" value={text} maxLength={4000} onChange={e => setText(e.target.value)} autoFocus rows={4}/></label>
          <p className="crew-date">{board?.control.mode === "live" ? "Your exact reply goes to the owning bot and stays pending until acknowledged." : "Saved as a shadow proposal. The request stays pending."}</p>
          <div className="crew-card-actions"><Dialog.Close asChild><button type="button" className="crew-button">Cancel</button></Dialog.Close><button className="crew-button crew-primary" disabled={busy || !text.trim()}>{board?.control.mode === "live" ? "Send reply" : "Save reply proposal"}</button></div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
