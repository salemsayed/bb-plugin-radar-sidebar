import { DeskThreads } from "./DeskThreads";
import { ClaimedThreads, useThreadClaims } from "./useThreadClaims";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { isClosed, isSameLocalDay, type Attempt, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { useBotTasks } from "./useBotTasks";
import { useDispatchWorkers } from "./useDispatchWorkers";
import { elapsed } from "./DispatchBoard";
import { StageFace } from "./StageFace";
import { rowLook, stageText, stageTitle } from "./stage";
import { clearsLine } from "./BotsView";
import { botStyle, shortBotName } from "./bots";

export const BOT_TAB = { id: "bot", context: { kind: "thread" as const }, availability: "fixed" as const };

export function useIsBotThread({ threadId }: { threadId: string }): boolean {
  const { data } = useBotTasks(true);
  return !!data?.bots.some(bot => bot.coordinatorThreadId === threadId);
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function BotPanelTab({ threadId }: { threadId: string }) {
  const { data } = useBotTasks(true);
  const bot = data?.bots.find(b => b.coordinatorThreadId === threadId);
  if (!data || !bot) return <p className="bot-panel-empty">This chat is not a bot's.</p>;
  return <BotPanel key={bot.key} bot={bot} />;
}

function statusWords(look: ReturnType<typeof rowLook>): string {
  if (look.kind === "ask") return "Needs you";
  if (look.pose === "blocked") return "Stuck";
  if (look.kind === "live") return look.helpers ? `Working · ${look.helpers} ${look.helpers === 1 ? "helper" : "helpers"}` : look.pose === "checking" ? "Checking" : "Working";
  if (look.pose === "offline") return "Offline";
  if (look.badge === "wait") return "Waiting";
  return "Resting";
}

function waitWhen(task: BotTaskRow, now: number): string {
  if (/^filed\.\s*not started/i.test(task.line)) return "not started";
  if (task.wakeAt !== undefined) return clearsLine(task.wakeAt, now);
  if (task.waitFor && task.waitFor !== "the bot") return "on someone";
  if (/wakes on thread-idle/i.test(task.line)) return "on a helper";
  return "no date";
}

function BotPanel({ bot }: { bot: BotTasksBot }) {
  const now = useNow();
  const claims = useThreadClaims();
  const navigate = useBbNavigate();
  const one = useMemo(() => ({ bots: [bot], needs: [], notFiled: [], observedAt: 0 }), [bot]);
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisibleSurface(root);
  const snapshot = useDispatchWorkers(one, visible);
  const running = (snapshot.byBot[bot.key] ?? []).filter(a => a.threadId !== bot.coordinatorThreadId);
  const look = rowLook(bot, { running: running.length, runningTitle: running[0]?.title, chatting: snapshot.chat.has(bot.key), unread: false, now });
  const open = bot.tasks.filter(t => !isClosed(t.displayState));
  const asks = open.filter(t => t.displayState === "needs");
  const titleOf = (attempt: Attempt) => {
    const task = bot.tasks.find(t => (snapshot.byTask[t.id] ?? []).some(a => a.threadId === attempt.threadId));
    return stageTitle(attempt.title || task?.title || "Helper");
  };
  const busyTasks = open.filter(t => (t.displayState === "working" || t.displayState === "queued" || t.displayState === "retrying" || t.displayState === "overdue" || t.displayState === "checking") && !(snapshot.byTask[t.id] ?? []).some(a => a.state === "running"));
  const waiting = open.filter(t => t.displayState === "waiting" || t.displayState === "ready" || t.displayState === "offline")
    .sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  const done = bot.tasks.filter(t => t.displayState === "done" && t.completedAt !== undefined && isSameLocalDay(t.completedAt, now))
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const go = (id: string | null | undefined) => navigate.toThread(id ?? bot.coordinatorThreadId);
  const hue = botStyle(bot.key, bot.name).hue;
  return <div ref={root} className="bot-panel" data-kind={look.kind} style={{ "--bot-hue": hue } as CSSProperties}>
    <header className="bot-hero">
      <StageFace botKey={bot.key} name={bot.name} pose={look.pose === "idle" && look.badge === "wait" ? "waiting" : look.pose} size={168} />
      <h2>{shortBotName(bot.name)}</h2>
      <p className="bot-status">{statusWords(look)}</p>
    </header>
    <div className="bot-panel-body">
      {asks.length ? <section aria-label="Asking you">
        <h3>Asking you</h3>
        {asks.map(t => <button type="button" key={t.id} className="bot-item bot-item-ask" onClick={() => go(t.needs?.threadId ?? t.conversationThreadId)}>
          <span className="bot-item-title">{stageText(t.needs?.question || t.line || t.title)}</span>
          <span className="bot-item-meta">{stageTitle(t.title)}</span>
        </button>)}
      </section> : null}
      <section aria-label="Now">
        <h3>Now</h3>
        {!snapshot.known.has(bot.key) && (busyTasks.length || look.kind === "live") ? <p className="bot-quiet">Checking helpers…</p> : running.length || busyTasks.length ? <>
          {running.map(a => <button type="button" key={a.threadId} className="bot-item" onClick={() => go(a.threadId)}>
            <span className="bot-item-title"><i className="bot-live-dot" aria-hidden="true" />{titleOf(a)}</span>
            <span className="bot-item-meta">{["Helper", a.startedAt != null ? elapsed(a.startedAt, now) : ""].filter(Boolean).join(" · ")}</span>
          </button>)}
          {busyTasks.map(t => <button type="button" key={t.id} className="bot-item" onClick={() => go(t.conversationThreadId)}>
            <span className="bot-item-title">{stageTitle(t.title)}</span>
            <span className="bot-item-meta">{t.displayState === "checking" ? "Checking the result" : t.displayState === "queued" ? "Queued" : t.displayState === "working" ? "With the bot" : stageText(t.line) || "Stuck"}</span>
          </button>)}
        </> : <p className="bot-quiet">{snapshot.chat.has(bot.key) ? "Chatting with you." : "Nothing running."}</p>}
      </section>
      {waiting.length ? <section aria-label="Waiting">
        <h3>Waiting</h3>
        {waiting.map(t => <button type="button" key={t.id} className="bot-item bot-item-row" onClick={() => go(t.conversationThreadId)}>
          <span className="bot-item-title">{stageTitle(t.title)}</span>
          <span className="bot-item-when">{t.displayState === "offline" ? "machine off" : t.displayState === "ready" ? "not started" : waitWhen(t, now)}</span>
        </button>)}
      </section> : null}
      <DeskThreads desks={bot.desks} now={now} onOpen={go} />
      <ClaimedThreads threads={claims.byBot[bot.key] ?? []} onOpen={go} />
      {done.length ? <section aria-label="Done today">
        <h3>Done today</h3>
        {done.map(t => <button type="button" key={t.id} className="bot-item bot-item-row bot-item-done" onClick={() => go(t.conversationThreadId)}>
          <span className="bot-item-title">{stageTitle(t.title)}</span>
          <span className="bot-item-when">{elapsed(t.completedAt!, now)}</span>
        </button>)}
      </section> : null}
    </div>
  </div>;
}
