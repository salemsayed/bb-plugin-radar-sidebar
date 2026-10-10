import { useEffect, useMemo, useState } from "react";
import { experimental_useSidebarThreads, useBbNavigate, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { chatgptLine, useChatgptStatus, type ChatgptStatus } from "@/lib/chatgptStatus";
import { useNeedsYou } from "@/lib/needsClient";
import { needsChanged } from "@/lib/needsClient";
import type { NeedsItem } from "@/lib/needs";
import { BotFace } from "./BotFace";
import { botStyle, QUIET_LINE, shortBotName, type BotState, type Pulse, type RosterBot } from "./bots";
import { botCoordinatorIds, botScopeIds, rosterRefreshKey } from "./botScope";
import { NeedsYouList } from "./NeedsYouList";
import { isRunningThread, shortAgo } from "./time";
import { useBotRoster } from "./useBotRoster";
import { useThreadPulses } from "./useThreadPulses";

/** A failed worker older than this is history, not something to act on now. */
const RECENT_FAILURE_MS = 24 * 3600_000;
const WORKERS_SHOWN = 3;
export type CardState = "needs-you" | "failed" | "working" | "queued" | "handover" | "waiting" | "quiet" | "unavailable";
const STATE_TEXT: Record<CardState, string> = {
  "needs-you": "Needs you", failed: "Failed", working: "Working", queued: "Queued", handover: "Handing over",
  waiting: "Machine offline", quiet: "Quiet", unavailable: "Unavailable",
};
/** The card's face wears the same expression as the bot row. */
const FACE_STATE: Record<CardState, BotState> = {
  "needs-you": "needs-you", failed: "failed", working: "working", queued: "queued", handover: "rollover",
  waiting: "unavailable", unavailable: "unavailable", quiet: "idle",
};
const RANK: Record<CardState, number> = { "needs-you": 0, failed: 1, working: 2, queued: 3, handover: 4, waiting: 5, unavailable: 6, quiet: 7 };
type WorkerState = "needs-you" | "failed" | "working" | "queued";
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export interface CrewCard {
  bot: RosterBot;
  state: CardState;
  coordinator: PluginSidebarThread | undefined;
  workers: { thread: PluginSidebarThread; state: WorkerState }[];
  olderFailures: number;
  /** quiet: the latest reply only signed off ("Nothing to do."). */
  reply: { text: string; at: number; quiet: boolean } | null;
  context: number | null;
  needs: number;
  chatgpt: { instructions: number; lastAt: number } | null;
}

function workerState(thread: PluginSidebarThread, now: number): WorkerState | null {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (isRunningThread(thread)) return "working";
  if (thread.status === "error" || thread.queuedWork === "failed") return now - thread.updatedAt < RECENT_FAILURE_MS ? "failed" : null;
  if (thread.queuedWork === "waiting") return "queued";
  return null;
}

/** One bot as Crew shows it: runtime evidence only, hidden workers included, old failures counted rather than listed. */
export function crewCard(bot: RosterBot, threads: readonly PluginSidebarThread[], pulse: Pulse | null, needs: readonly NeedsItem[] | null,
  chatgpt: ChatgptStatus | null, now: number): CrewCard {
  const ids = botScopeIds(threads, bot);
  const roots = botCoordinatorIds(bot);
  const coordinator = threads.find(t => t.id === bot.current && !t.isArchived);
  const family = threads.filter(t => ids.has(t.id) && !roots.has(t.id) && !t.isArchived);
  const workers = family.flatMap(thread => { const state = workerState(thread, now); return state ? [{ thread, state }] : []; })
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.thread.updatedAt - a.thread.updatedAt);
  const olderFailures = family.filter(t => (t.status === "error" || t.queuedWork === "failed") && now - t.updatedAt >= RECENT_FAILURE_MS).length;
  const coordinatorBlocked = !!coordinator && (coordinator.hasPendingInteraction || coordinator.indicator === "waiting-for-input");
  const state: CardState = !coordinator ? "unavailable"
    : coordinatorBlocked || workers.some(w => w.state === "needs-you") ? "needs-you"
    : coordinator.status === "error" || workers.some(w => w.state === "failed") ? "failed"
    : isRunningThread(coordinator) || workers.some(w => w.state === "working") ? "working"
    : bot.rollover ? "handover"
    : coordinator.queuedWork === "waiting" || workers.some(w => w.state === "queued") ? "queued"
    : coordinator.runtimeStatus === "waiting-for-host" ? "waiting" : "quiet";
  const text = pulse?.preview ?? pulse?.subject ?? null;
  return {
    bot, state, coordinator, workers, olderFailures,
    reply: text && coordinator ? { text, at: coordinator.latestAttentionAt, quiet: QUIET_LINE.test(text.trim()) } : null,
    context: pulse?.context ?? null,
    needs: (needs ?? []).filter(item => item.bot === bot.key && item.state !== "snoozed").length,
    chatgpt: chatgpt?.status?.activity[bot.key] ?? null,
  };
}

function ContextRing({ value }: { value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return <span className={cn("crew-ring", value >= 0.75 && "crew-ring-hot", value >= 0.6 && value < 0.75 && "crew-ring-warm")}
    style={{ "--ring": `${percent}%` } as React.CSSProperties} role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    title={`${percent}% of the context window used`}><span>{percent}</span></span>;
}

/** Crew: what needs Salem, then one card per bot. ChatGPT coordinates; this page only reads. */
export function CrewWorkspace() {
  const navigate = useBbNavigate();
  const sidebar = experimental_useSidebarThreads();
  const roster = useBotRoster(true, rosterRefreshKey(sidebar.threads));
  const needs = useNeedsYou(true);
  const chatgpt = useChatgptStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const coordinators = useMemo(() => sidebar.threads.filter(t => roster.some(bot => bot.current === t.id)), [sidebar.threads, roster]);
  const pulses = useThreadPulses(coordinators, true);
  const cards = useMemo(() => roster.map(bot => crewCard(bot, sidebar.threads, pulses.get(bot.current) ?? null, needs.items, chatgpt, now))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.needs - a.needs), [roster, sidebar.threads, pulses, needs.items, chatgpt, now]);
  const blocked = cards.flatMap(card => [
    ...(card.coordinator && (card.coordinator.hasPendingInteraction || card.coordinator.indicator === "waiting-for-input") ? [{ bot: card.bot, thread: card.coordinator }] : []),
    ...card.workers.filter(w => w.state === "needs-you").map(w => ({ bot: card.bot, thread: w.thread })),
  ]);
  const line = chatgptLine(chatgpt, now, ms => day.format(ms));
  const waiting = (needs.items ?? []).filter(item => item.state !== "snoozed").length + blocked.length;
  const ready = sidebar.status === "ready" && roster.length > 0;
  const open = (threadId: string) => navigate.toThread(threadId);

  return <div className="crew-workspace">
    <header className="crew-workspace-header">
      <h1>Crew</h1>
      {line ? <p className={cn("crew-chatgpt", `crew-chatgpt-${line.tone}`)} role="status">{line.text}</p> : <p className="crew-subtitle">Your bots at a glance</p>}
    </header>
    <div className="crew-overview-scroll"><main className="crew-overview">
      <section aria-label="Needs you" className="crew-needs">
        {blocked.length ? <ul className="crew-blocked" aria-label="Waiting for your answer or approval">{blocked.map(({ bot, thread }) => <li key={thread.id}>
          <BotFace botKey={bot.key} name={bot.name} state="needs-you" size={20} />
          <span className="crew-blocked-text"><strong>{shortBotName(bot.name)}</strong> {thread.id === bot.current ? "is waiting for your answer or approval" : `· ${thread.displayTitle || "A worker"} is waiting for your answer or approval`}</span>
          <button type="button" className="crew-button crew-primary" onClick={() => open(thread.id)}>Review</button>
        </li>)}</ul> : null}
        {needs.items === null ? <p role="status" className="crew-calm">
          {needs.status === "loading" ? "Loading saved questions…" : <>Saved questions are unavailable. <button type="button" className="crew-button" onClick={needsChanged}>Retry</button></>}
        </p> : <NeedsYouList items={needs.items} roster={roster} now={now} onUpdate={needs.update} onOpen={open} />}
        {/* All clear only when every bot's coordinator could be read too: it once showed beside "Live bot activity is
            unavailable.", and beside a bot whose coordinator was missing from the list (Astra, 2026-10-10). */}
        {needs.items !== null && ready && cards.every(card => card.coordinator) && !waiting ? <p className="crew-calm crew-all-clear">Nothing needs you.</p> : null}
      </section>
      <section aria-labelledby="crew-bots-title">
        <h2 id="crew-bots-title" className="crew-section-title">Bots</h2>
        {!ready ? <p className="crew-calm" role="status">{sidebar.status === "loading" || !roster.length ? "Loading bots…" : "Live bot activity is unavailable."}</p> : null}
        <div className="crew-grid">{cards.map(card => <BotCard key={card.bot.key} card={card} now={now} onOpen={open} />)}</div>
      </section>
    </main></div>
  </div>;
}

function BotCard({ card, now, onOpen }: { card: CrewCard; now: number; onOpen: (threadId: string) => void }) {
  const { bot, state, coordinator, workers, reply, context, needs, chatgpt, olderFailures } = card;
  const style = botStyle(bot.key, bot.name);
  return <article className={cn("crew-card", `crew-card-${state}`)} style={{ "--bot-hue": style.hue } as React.CSSProperties} aria-label={`${bot.name}: ${STATE_TEXT[state]}`}>
    <button type="button" className="crew-card-head" onClick={() => onOpen(bot.current)} aria-label={`Open ${bot.name}`}>
      <BotFace botKey={bot.key} name={bot.name} state={FACE_STATE[state]} size={30} />
      <span className="crew-card-name"><strong>{shortBotName(bot.name)}</strong><small>{coordinator?.host?.name ?? "Unknown machine"}</small></span>
      <span className={cn("crew-chip", `crew-chip-${state}`)}>{STATE_TEXT[state]}</span>
      {context !== null ? <ContextRing value={context} /> : null}
    </button>
    {workers.length ? <div className="crew-card-section">
      <span className="crew-label">Now</span>
      <ul className="crew-workers">{workers.slice(0, WORKERS_SHOWN).map(({ thread, state: worker }) => <li key={thread.id}>
        <button type="button" onClick={() => onOpen(thread.id)} className={`crew-worker crew-worker-${worker}`}>
          <span className="crew-worker-dot" aria-hidden="true" /><span className="crew-worker-title">{thread.displayTitle || "Untitled worker"}</span>
          <span className="crew-worker-meta">{worker === "working" ? shortAgo(thread.updatedAt, now) : STATE_TEXT[worker]}</span>
        </button>
      </li>)}</ul>
      {workers.length > WORKERS_SHOWN ? <span className="crew-muted">{workers.length - WORKERS_SHOWN} more</span> : null}
    </div> : null}
    {reply?.quiet ? <p className="crew-muted">Nothing new · last reply {clock.format(reply.at)}</p>
      : reply ? <div className="crew-card-section">
        <span className="crew-label">Last reply {clock.format(reply.at)}</span>
        <p className="crew-reply">{reply.text}</p>
      </div> : <p className="crew-muted">{state === "working" ? "Working on a reply…" : "No reply yet."}</p>}
    {chatgpt || needs || olderFailures ? <div className="crew-card-foot">
      {chatgpt ? <span className="crew-via" title="Instructions ChatGPT sent this bot today">ChatGPT sent {chatgpt.instructions} instruction{chatgpt.instructions === 1 ? "" : "s"} today · last {clock.format(chatgpt.lastAt)}</span> : null}
      {needs ? <span className="crew-muted">{needs} on your list</span> : null}
      {olderFailures ? <span className="crew-muted">{olderFailures} older failed worker{olderFailures === 1 ? "" : "s"}</span> : null}
    </div> : null}
  </article>;
}
