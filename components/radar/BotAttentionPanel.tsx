import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, useBbContext, useBbNavigate, useComposers, useRpc, useSdk, type PluginThreadPanelProps, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { attentionCards, attentionDueAt, botAttentionContract, consumeBotAttention, type AttentionBoard, type AttentionCard } from "@/lib/botAttention";
import { attentionRpcContract } from "@/lib/attention";
import { needsRpcContract } from "@/lib/needs";
import { needsChanged } from "@/lib/needsClient";
import { ReminderTimePicker } from "./ReminderTimePicker";
import "./bot-attention.css";

function useBoard(threadId: string) {
  const rpc = useRpc<typeof botAttentionContract>();
  const [board, setBoard] = useState<AttentionBoard | null>(null), [error, setError] = useState<string | null>(null);
  const alive = useRef(0);
  const refresh = useCallback(async () => {
    const generation = alive.current;
    try { const r = await rpc.call("bot_attention", { threadId }); if (alive.current === generation) { setBoard(r.board); setError(null); } }
    catch { if (alive.current === generation) setError("Attention couldn’t load. Try again."); }
  }, [rpc, threadId]);
  useEffect(() => {
    alive.current++; setBoard(null); void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => { alive.current++; clearInterval(timer); };
  }, [refresh]);
  return { board, error, refresh };
}

/** Intersection is a displayed occurrence receipt, never a whole-bot read receipt.
 * Require continuous foreground visibility; collapsed history never mounts a receipt. */
function DisplayedOccurrence({ events, acknowledge, children }: { events: AttentionCard["events"]; acknowledge: (ids: string[]) => Promise<void>; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const ids = events.filter(e => e.seenAt === null && e.resolvedAt === null).map(e => e.id).join(",");
  useEffect(() => {
    if (!ids || !ref.current || typeof IntersectionObserver === "undefined") return;
    let visible = false, timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer) clearTimeout(timer);
      if (visible && document.visibilityState === "visible" && document.hasFocus()) timer = setTimeout(() => { void acknowledge(ids.split(",")).catch(() => {}); }, 1200);
    };
    const observer = new IntersectionObserver(entries => { visible = !!entries[0]?.isIntersecting && entries[0].intersectionRatio >= 1; update(); }, { threshold: [1] });
    observer.observe(ref.current); document.addEventListener("visibilitychange", update); window.addEventListener("focus", update); window.addEventListener("blur", update);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update); };
  }, [ids, acknowledge]);
  return <div ref={ref as React.RefObject<HTMLDivElement>} data-attention-occurrences={ids}>{children}</div>;
}

export function BotAttentionHeader({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { board } = useBoard(threadId); const navigate = useBbNavigate(); const context = useBbContext();
  const entered = useRef<string | null>(null);
  const open = useCallback(() => navigate.openThreadPanel({ actionId: "bot-attention", title: "Attention" }), [navigate]);
  useEffect(() => {
    const entry = () => { if (consumeBotAttention(threadId)) open(); };
    entry(); window.addEventListener("radar:attention-entry", entry); return () => window.removeEventListener("radar:attention-entry", entry);
  }, [threadId, open]);
  useEffect(() => {
    if (context.threadId !== threadId) { entered.current = null; return; }
    if (!board || entered.current === threadId) return;
    entered.current = threadId;
    if (board.current === threadId && attentionCards(board, Date.now()).some(c => c.section === "attention")) open();
  }, [context.threadId, threadId, board, open]);
  if (!board) return null;
  const count = attentionCards(board, Date.now()).filter(c => c.section === "attention").length;
  return <button type="button" className="bot-attention-header" onClick={open} aria-label={`Attention${count ? `, ${count} items` : ""}`} title="Bot attention">{isCompactViewport ? "◎" : "Attention"}{count ? <b>{count}</b> : null}</button>;
}

export function BotAttentionPanel({ threadId }: PluginThreadPanelProps) {
  const { board, error, refresh } = useBoard(threadId);
  const rpc = useRpc<typeof attentionRpcContract & typeof needsRpcContract>();
  const navigate = useBbNavigate(); const composers = useComposers(); const sdk = useSdk();
  const [busy, setBusy] = useState<string | null>(null), [failure, setFailure] = useState<string | null>(null), [picker, setPicker] = useState<string | null>(null);
  const [history, setHistory] = useState(false), [later, setLater] = useState(false);
  const acknowledge = useCallback(async (ids: string[]) => {
    await rpc.call("crew_attention_seen", { ids }); needsChanged(); await refresh();
  }, [rpc, refresh]);
  async function change(id: string, action: "done" | "snooze" | "reopen", until?: string) {
    setBusy(id); setFailure(null);
    try { await rpc.call("crew_needs_update", { id, action, ...(until ? { until } : {}) }); setPicker(null); needsChanged(); await refresh(); }
    catch { setFailure("Couldn’t save that change. Try again."); } finally { setBusy(null); }
  }
  function reply(card: AttentionCard) {
    if (!board || !card.item) return;
    const form = card.events.find(e => e.interactionId && e.resolvedAt === null);
    if (form) { navigate.toThread(form.interactionThreadId ?? form.threadId); return; }
    const composer = composers.find(c => c.scope.kind === "thread" && c.scope.threadId === board.current);
    if (!composer) { setFailure("Open the current coordinator to reply."); navigate.toThread(board.current); return; }
    if (!composer.isEmpty) { setFailure("Send or clear your current draft first."); composer.focus(); return; }
    composer.insert(["Re: ", { provider: "bot-attention", id: card.item.id, label: card.item.text }, "\n\n"], { at: "end" }); composer.focus();
  }
  async function openSource(card: AttentionCard) {
    if (!board) return;
    const target = card.item?.source.threadId ?? card.events[0]?.threadId ?? board.current;
    try { const thread = await sdk.threads.get({ threadId: target }); navigate.toThread(thread.deletedAt ? board.current : target); }
    catch { navigate.toThread(board.current); }
  }
  if (error) return <section className="bot-attention"><p role="alert">{error}</p><button onClick={() => void refresh()}>Retry</button></section>;
  if (!board) return <p role="status">Loading bot attention…</p>;
  const cards = attentionCards(board, Date.now());
  const render = (card: AttentionCard) => {
    const item = card.item;
    const unseen = card.events.filter(e => e.seenAt === null && e.resolvedAt === null);
    const context = [...new Set(card.events.map(e => e.summary))].filter(summary => summary !== item?.text);
    return <article key={card.id} className="bot-attention-card">
      <div className="bot-attention-card-heading"><small>{item ? item.kind === "decision" ? "Question" : "Reminder" : card.events[0]?.kind === "completion" ? "Completed" : "Update"}</small>{unseen.length ? <span aria-label="Unseen update" className="bot-attention-new">New</span> : null}</div>
      {item ? <DisplayedOccurrence events={card.events.filter(e => e.summary === item.text)} acknowledge={acknowledge}><h3>{item.text}</h3></DisplayedOccurrence> : null}
      {context.map((text, n) => <DisplayedOccurrence key={n} events={card.events.filter(e => e.summary === text)} acknowledge={acknowledge}><Markdown content={text} /></DisplayedOccurrence>)}
      {item && board.holds.find(h => h.itemId === item.id)?.condition ? <p className="bot-attention-date">Waiting: {board.holds.find(h => h.itemId === item.id)!.condition}</p> : null}
      {item?.due ? <p className="bot-attention-date">Due {item.due.slice(0, 10)}</p> : null}
      {item?.snoozeUntil ? <p className="bot-attention-date">Remind {new Date(attentionDueAt(item.snoozeUntil)).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })} Cairo</p> : null}
      <div className="bot-attention-actions">
        {item && card.section !== "history" ? <>
          {item.kind === "decision" ? <button onClick={() => reply(card)}>{card.events.some(e => e.interactionId && e.resolvedAt === null) ? "Answer form" : "Reply"}</button> : <button disabled={busy === item.id} onClick={() => void change(item.id, "done")}>Done</button>}
          <button disabled={busy === item.id} onClick={() => setPicker(picker === item.id ? null : item.id)}>Later</button>
        </> : item ? <button disabled={busy === item.id} onClick={() => void change(item.id, "reopen")}>Reopen</button> : null}
        <button onClick={() => void openSource(card)}>Source</button>
        {unseen.length ? <button onClick={() => void acknowledge(unseen.map(e => e.id)).catch(() => setFailure("Couldn’t mark this update seen."))}>Seen</button> : null}
      </div>
      {item && picker === item.id ? <ReminderTimePicker now={Date.now()} busy={busy === item.id} onChoose={until => void change(item.id, "snooze", until)} onCancel={() => setPicker(null)} /> : null}
    </article>;
  };
  const active = cards.filter(c => c.section === "attention"), deferred = cards.filter(c => c.section === "later"), past = cards.filter(c => c.section === "history");
  return <section className="bot-attention" aria-label="Bot attention">
    <header><h2>Attention</h2><p>Questions, reminders and important updates from this bot.</p></header>
    {failure ? <p role="alert">{failure}</p> : null}
    {active.length ? active.map(render) : <p className="bot-attention-empty">You’re caught up.</p>}
    {board.work.filter(w => w.state === "pending" || w.state === "held").length ? <details><summary>With the bot</summary>{board.work.filter(w => w.state === "pending" || w.state === "held").map(w => <p key={w.key}>{w.summary}{w.state === "held" ? " · Waiting" : ""}</p>)}</details> : null}
    {deferred.length ? <><button className="bot-attention-fold" aria-expanded={later} onClick={() => setLater(!later)}>Later · {deferred.length}</button>{later ? deferred.map(render) : null}</> : null}
    {past.length ? <><button className="bot-attention-fold" aria-expanded={history} onClick={() => setHistory(!history)}>History · {past.length}</button>{history ? past.map(render) : null}</> : null}
    {board.more ? <p>More saved history exists. Open Source for the full conversation.</p> : null}
  </section>;
}
