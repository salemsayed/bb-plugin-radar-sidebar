import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown, useBbContext, useBbNavigate, useComposers, useRpc, useSdk, type PluginThreadPanelProps, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { attentionCards, attentionDueAt, botAttentionContract, consumeBotAttention, type AttentionBoard, type AttentionCard } from "@/lib/botAttention";
import { attentionRpcContract } from "@/lib/attention";
import { needsRpcContract } from "@/lib/needs";
import { needsChanged } from "@/lib/needsClient";
import { ReminderTimePicker } from "./ReminderTimePicker";
import { Icon } from "@/components/ui/icon";
import { timeAgo } from "./time";
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
 * Require continuous foreground visibility of the complete content: a clamped body
 * only qualifies once expanded, and collapsed history never mounts a receipt. */
function DisplayedOccurrence({ events, acknowledge, clamp = false, children }: { events: AttentionCard["events"]; acknowledge: (ids: string[]) => Promise<void>; clamp?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false), [overflow, setOverflow] = useState(clamp);
  const clamped = clamp && !expanded;
  useLayoutEffect(() => {
    const el = body.current;
    if (!clamped || !el) return;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 2);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect();
  }, [clamped, children]);
  const complete = !clamped || !overflow;
  const ids = complete ? events.filter(e => e.seenAt === null && e.resolvedAt === null).map(e => e.id).join(",") : "";
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
  return <div ref={ref} className="bot-attention-occurrence" data-attention-occurrences={ids}>
    <div ref={body} className={clamped && overflow ? "bot-attention-clamped" : clamped ? "bot-attention-clamp" : undefined}>{children}</div>
    {clamp && overflow ? <button type="button" className="bot-attention-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button> : null}
  </div>;
}

type Tone = "question" | "urgent" | "reminder" | "update" | "done";
const CAIRO = "Africa/Cairo";
const cairoDay = (ms: number) => Date.parse(new Date(ms).toLocaleDateString("en-CA", { timeZone: CAIRO }));
const dayName = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: CAIRO, weekday: "short", day: "numeric", month: "short" });
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: CAIRO, hour: "2-digit", minute: "2-digit" });

function kindOf(card: AttentionCard): { label: string; icon: string; tone: Tone } {
  const item = card.item;
  if (item?.kind === "decision") return { label: "Question", icon: "MessageQuestion", tone: "question" };
  if (item?.kind === "urgent") return { label: "Urgent", icon: "AlertTriangle", tone: "urgent" };
  if (item) return { label: item.kind === "deadline" ? "Deadline" : "Reminder", icon: "Target", tone: "reminder" };
  return card.events[0]?.kind === "completion" ? { label: "Completed", icon: "CircleCheck", tone: "done" } : { label: "Update", icon: "Info", tone: "update" };
}

function dueLabel(due: string, now: number): { text: string; overdue: boolean } {
  const at = attentionDueAt(due), days = Math.round((cairoDay(at) - cairoDay(now)) / 86_400_000);
  if (days < 0) return { text: `Overdue since ${dayName(at)}`, overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  return { text: days < 7 ? `Due ${dayName(at)} · in ${days} days` : `Due ${dayName(at)}`, overdue: false };
}

/** Display only: the bots' " | " field separators become lines and their field labels stand out. */
function readable(text: string): string {
  if (/^\s*\|/m.test(text)) return text;
  return text.replace(/ \| /g, "  \n").replace(/( {2}\n)([A-Z][A-Za-z ]{1,20}):/g, "$1**$2:**");
}

const latest = (card: AttentionCard) => Math.max(...card.events.map(e => e.createdAt), card.item ? Date.parse(card.item.createdAt) : 0);
const wakesAt = (card: AttentionCard) => card.item?.snoozeUntil ? attentionDueAt(card.item.snoozeUntil) : card.item?.due ? attentionDueAt(card.item.due) : Infinity;

function Fold({ label, count, hint, open, onToggle }: { label: string; count: number; hint?: string; open: boolean; onToggle: () => void }) {
  return <button type="button" className="bot-attention-fold" aria-expanded={open} onClick={onToggle}>
    <Icon name="ChevronRight" aria-hidden className="bot-attention-chevron" />
    <span>{label}</span><span className="bot-attention-count">{count}</span>
    {hint ? <small>{hint}</small> : null}
  </button>;
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
  return <button type="button" className={`bot-attention-header${count ? " has-items" : ""}`} onClick={open} aria-label={`Attention${count ? `, ${count} items` : ""}`} title="Bot attention">
    {isCompactViewport ? <Icon name="Target" aria-hidden /> : "Attention"}{count ? <b>{count}</b> : null}
  </button>;
}

export function BotAttentionPanel({ threadId }: PluginThreadPanelProps) {
  const { board, error, refresh } = useBoard(threadId);
  const rpc = useRpc<typeof attentionRpcContract & typeof needsRpcContract>();
  const navigate = useBbNavigate(); const composers = useComposers(); const sdk = useSdk();
  const [busy, setBusy] = useState<string | null>(null), [failure, setFailure] = useState<string | null>(null), [picker, setPicker] = useState<string | null>(null);
  const [history, setHistory] = useState(false), [later, setLater] = useState(false), [withBot, setWithBot] = useState(false), [historyLimit, setHistoryLimit] = useState(20);
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
  if (error) return <section className="bot-attention"><div className="bot-attention-error" role="alert"><Icon name="AlertCircle" aria-hidden /><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div></section>;
  if (!board) return <section className="bot-attention" aria-busy="true"><p role="status" className="bot-attention-sr">Loading bot attention…</p><div className="bot-attention-skeleton" /><div className="bot-attention-skeleton" /></section>;
  const now = Date.now();
  const cards = attentionCards(board, now);
  const unseenOf = (card: AttentionCard) => card.events.filter(e => e.seenAt === null && e.resolvedAt === null);
  const render = (card: AttentionCard) => {
    const item = card.item, past = card.section === "history";
    const kind = kindOf(card), unseen = unseenOf(card);
    const context = [...new Set(card.events.map(e => e.summary))].filter(summary => summary !== item?.text);
    const hold = item ? board.holds.find(h => h.itemId === item.id) : undefined;
    const due = item?.due && !past ? dueLabel(item.due, now) : null;
    const when = latest(card);
    const busyHere = !!item && busy === item.id;
    const seenButton = unseen.length ? <button type="button" className={item || past ? undefined : "is-primary"} onClick={() => void acknowledge(unseen.map(e => e.id)).catch(() => setFailure("Couldn’t mark this update seen."))}>Seen</button> : null;
    const sourceButton = <button type="button" className="bot-attention-source" onClick={() => void openSource(card)}>Source<Icon name="ChevronRight" aria-hidden /></button>;
    return <article key={card.id} className={`bot-attention-card bot-attention-${kind.tone}${unseen.length ? " is-new" : ""}${past ? " is-past" : ""}`}>
      <div className="bot-attention-card-heading">
        <span className="bot-attention-kind"><Icon name={kind.icon} aria-hidden />{kind.label}</span>
        {when ? <time title={new Date(when).toLocaleString("en-GB", { timeZone: CAIRO })}>{timeAgo(when, now)}</time> : null}
        {due ? <span className={`bot-attention-due${due.overdue ? " is-overdue" : ""}`}>{due.text}</span> : null}
        {past && item ? <span className="bot-attention-closed">{item.state === "dropped" ? "Dropped" : "Done"}{item.closedAt ? ` ${dayName(Date.parse(item.closedAt))}` : ""}</span> : null}
        {unseen.length ? <span aria-label="Unseen update" className="bot-attention-new">New</span> : null}
        {past ? <span className="bot-attention-actions bot-attention-inline">
          {item ? <button type="button" disabled={busyHere} onClick={() => void change(item.id, "reopen")}>Reopen</button> : null}
          {seenButton}{sourceButton}
        </span> : null}
      </div>
      {item ? <DisplayedOccurrence events={card.events.filter(e => e.summary === item.text)} acknowledge={acknowledge} clamp={past}><h3>{item.text}</h3></DisplayedOccurrence> : null}
      {context.map((text, n) => <DisplayedOccurrence key={n} events={card.events.filter(e => e.summary === text)} acknowledge={acknowledge} clamp><Markdown content={readable(text)} /></DisplayedOccurrence>)}
      {hold?.condition && !past ? <p className="bot-attention-note"><Icon name="Info" aria-hidden /><span><b>Waiting</b> · {hold.condition}</span></p> : null}
      {item?.snoozeUntil && !past ? <p className="bot-attention-note"><Icon name="Target" aria-hidden /><span><b>Back</b> {dayName(attentionDueAt(item.snoozeUntil))}, {clock(attentionDueAt(item.snoozeUntil))} Cairo</span></p> : null}
      {past ? null : <div className="bot-attention-actions">
        {item ? <>
          {item.kind === "decision"
            ? <button type="button" className="is-primary" onClick={() => reply(card)}>{card.events.some(e => e.interactionId && e.resolvedAt === null) ? "Answer form" : "Reply"}</button>
            : <button type="button" className="is-primary" disabled={busyHere} onClick={() => void change(item.id, "done")}>Done</button>}
          <button type="button" disabled={busyHere} aria-expanded={picker === item.id} onClick={() => setPicker(picker === item.id ? null : item.id)}>Later</button>
        </> : null}
        {seenButton}
        {sourceButton}
      </div>}
      {item && picker === item.id ? <ReminderTimePicker now={now} busy={busyHere} onChoose={until => void change(item.id, "snooze", until)} onCancel={() => setPicker(null)} /> : null}
    </article>;
  };
  const active = cards.filter(c => c.section === "attention");
  const deferred = cards.filter(c => c.section === "later").sort((a, b) => wakesAt(a) - wakesAt(b));
  const past = cards.filter(c => c.section === "history");
  const work = board.work.filter(w => w.state === "pending" || w.state === "held");
  const unseenAll = active.filter(c => !c.item).flatMap(c => unseenOf(c).map(e => e.id));
  const next = deferred.find(c => wakesAt(c) !== Infinity);
  const summary = [active.length ? `${active.length} need${active.length === 1 ? "s" : ""} you` : "Nothing needs you", deferred.length ? `${deferred.length} later` : "", work.length ? `${work.length} with the bot` : ""].filter(Boolean).join(" · ");
  return <section className="bot-attention" aria-label="Bot attention">
    <header className="bot-attention-top">
      <div><h2>Attention</h2><p>{summary}</p></div>
      {unseenAll.length > 1 ? <button type="button" onClick={() => void acknowledge(unseenAll).catch(() => setFailure("Couldn’t mark these updates seen."))}>Mark all seen</button> : null}
    </header>
    {failure ? <p className="bot-attention-error" role="alert"><Icon name="AlertCircle" aria-hidden /><span>{failure}</span></p> : null}
    {active.length ? <div className="bot-attention-list">{active.map(render)}</div> : <div className="bot-attention-empty">
      <Icon name="CircleCheck" aria-hidden /><strong>You’re caught up</strong><span>Questions, reminders and important updates from this bot land here.</span>
    </div>}
    {work.length ? <div className="bot-attention-group">
      <Fold label="With the bot" count={work.length} open={withBot} onToggle={() => setWithBot(!withBot)} />
      {withBot ? <ul className="bot-attention-work">{work.map(w => <li key={w.key}><span>{w.summary}</span>{w.state === "held" ? <small>Waiting</small> : null}</li>)}</ul> : null}
    </div> : null}
    {deferred.length ? <div className="bot-attention-group">
      <Fold label="Later" count={deferred.length} hint={next ? `next ${dayName(wakesAt(next))}` : undefined} open={later} onToggle={() => setLater(!later)} />
      {later ? <div className="bot-attention-list">{deferred.map(render)}</div> : null}
    </div> : null}
    {past.length ? <div className="bot-attention-group">
      <Fold label="History" count={past.length} open={history} onToggle={() => setHistory(!history)} />
      {history ? <div className="bot-attention-list">{past.slice(0, historyLimit).map(render)}
        {past.length > historyLimit ? <button type="button" className="bot-attention-more" onClick={() => setHistoryLimit(historyLimit + 20)}>Show older ({past.length - historyLimit})</button> : null}
      </div> : null}
    </div> : null}
    {board.more ? <p className="bot-attention-footnote">More saved history exists. Open Source for the full conversation.</p> : null}
  </section>;
}
