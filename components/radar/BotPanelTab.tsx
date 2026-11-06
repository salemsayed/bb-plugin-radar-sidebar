import { DeskThreads } from "./DeskThreads";
import { Icon } from "@/components/ui/icon";
import { useThreadClaims } from "./useThreadClaims";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { isClosed, isSameLocalDay, type Attempt, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { useBotTasks } from "./useBotTasks";
import { useNeedsYou } from "@/lib/needsClient";
import { applyNotNow, useNotNow } from "@/lib/notNow";
import { withQuestions } from "./questions";
import { useBotWorkers } from "./useDispatchWorkers";
import { ago } from "./DispatchBoard";
import { workerNames } from "./workText";
import { StageFace } from "./StageFace";
import { awaitedPerson, rowLook, stageText, stageTitle, taskAsk, waitLine } from "./stage";
import { oneForm } from "./NeedsSummary";
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
  const { data: raw } = useBotTasks(true);
  const bell = useNeedsYou(true);
  const later = useNotNow(raw?.notNow);
  const data = raw ? applyNotNow(withQuestions(raw, bell.items, later.laterAt).data, later) : raw;
  const bot = data?.bots.find(b => b.coordinatorThreadId === threadId);
  if (!data || !bot) return <p className="bot-panel-empty">This chat is not a bot's.</p>;
  return <BotPanel key={bot.key} bot={bot} here={threadId} />;
}

function statusWords(look: ReturnType<typeof rowLook>): string {
  if (look.kind === "ask") return "Needs you";
  if (look.pose === "blocked") return "Stuck";
  if (look.kind === "live") return look.helpers ? `Working · ${look.helpers} ${look.helpers === 1 ? "worker" : "workers"} running` : look.pose === "checking" ? "Checking a result" : "Working";
  if (look.pose === "offline") return "Machine off";
  if (look.badge === "wait") return "Waiting";
  return "Idle";
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
function doneDay(at: number, now: number): string {
  const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  return Math.round((day(now) - day(at)) / 86_400_000) === 1 ? "yesterday" : weekday.format(new Date(at));
}

function closedWord(task: BotTaskRow): string {
  return /^Closed by (?:Salem|you)\b/i.test(task.line) ? "Closed by you" : "Done";
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}


function waitWhen(task: BotTaskRow, now: number): string {
  if (task.displayState === "offline") return "Its machine is off";
  if (task.displayState === "ready" || /^filed\.\s*not started/i.test(task.line)) return "Not started yet";
  const line = capitalize(waitLine(task, now));
  const who = awaitedPerson(task);
  return who && !line.includes(who) ? `Waiting on ${who} · ${line[0]!.toLowerCase()}${line.slice(1)}` : line;
}

function busyWords(task: BotTaskRow, botName: string): string {
  if (task.displayState === "checking") return "Checking the result";
  if (task.displayState === "queued") return "Queued, starts soon";
  if (task.displayState === "working") return `${botName} is working on it`;
  return stageText(task.line) || "Stuck";
}

function Row({ title, meta, detail, impact, target, here, done, live, ask, onOpen, onContinue }: {
  title: string; meta: string; detail?: string; impact?: string; target: string | null; here: string; done?: boolean; live?: boolean; ask?: boolean;
  onOpen: (id: string) => void; onContinue?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opens = !!target && target !== here;
  const more = !opens && (!!detail || !!onContinue);
  const cls = ["bot-item", done ? "bot-item-done" : "", ask ? "bot-item-ask" : "", opens ? "bot-item-opens" : ""].filter(Boolean).join(" ");
  const body = <>
    <span className="bot-item-title">{live ? <i className="bot-live-dot" aria-hidden="true" /> : null}<span dir="auto">{title}</span></span>
    {impact ? <span className="bot-item-impact" dir="auto">{impact}</span> : null}
    <span className="bot-item-meta" dir="auto">{meta}</span>
    {opens || more ? <span className="bot-item-go" aria-hidden="true"><Icon name={opens ? "ArrowUpRight" : open ? "ChevronUp" : "ChevronDown"} aria-hidden="true" /></span> : null}
  </>;
  if (!opens && !more) return <div className={cls} role="listitem">{body}</div>;
  return <div className="bot-item-wrap" role="listitem" data-open={open || undefined}>
    <button type="button" className={cls} aria-label={`${title}.${impact ? ` ${impact}` : ""} ${meta}.${opens ? " Open its chat" : open ? " Hide details" : " Show details"}`} aria-expanded={opens ? undefined : open}
      onClick={() => opens ? onOpen(target!) : setOpen(value => !value)}>{body}</button>
    {open ? <div className="bot-item-more">
      {detail ? <p dir="auto">{detail}</p> : null}
      {onContinue ? <button type="button" className="bot-item-continue" onClick={onContinue}>Continue in chat</button> : null}
    </div> : null}
  </div>;
}

function BotPanel({ bot, here }: { bot: BotTasksBot; here: string }) {
  const now = useNow();
  const claims = useThreadClaims();
  const navigate = useBbNavigate();
  const one = useMemo(() => ({ bots: [bot], needs: [], notFiled: [], observedAt: 0 }), [bot]);
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisibleSurface(root);
  const snapshot = useBotWorkers(one, visible);
  const running = (snapshot.byBot[bot.key] ?? []).filter(a => a.threadId !== bot.coordinatorThreadId);
  const look = rowLook(bot, { running: running.length, runningTitle: running[0]?.title, chatting: snapshot.chat.has(bot.key), unread: false, now });
  const open = bot.tasks.filter(t => !isClosed(t.displayState));
  const asks = open.filter(t => t.displayState === "needs");
  const names = workerNames(running, attempt => stageTitle(bot.tasks.find(t => (snapshot.byTask[t.id] ?? []).some(a => a.threadId === attempt.threadId))?.title || "Worker"));
  const titleOf = (attempt: Attempt) => names.get(attempt.threadId) ?? "Worker";
  const known = snapshot.known.has(bot.key);
  const busyTasks = open.filter(t => (t.displayState === "working" || t.displayState === "queued" || t.displayState === "retrying" || t.displayState === "overdue" || t.displayState === "checking") && !(snapshot.byTask[t.id] ?? []).some(a => a.state === "running"));
  const waiting = open.filter(t => t.displayState === "waiting" || t.displayState === "ready" || t.displayState === "offline")
    .sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  const closed = bot.tasks.filter(t => t.displayState === "done" && t.completedAt !== undefined).sort((a, b) => b.completedAt! - a.completedAt!);
  const done = closed.filter(t => isSameLocalDay(t.completedAt!, now));
  const awaited = [...new Set(waiting.map(awaitedPerson))];
  const headerWords = statusWords(look) === "Waiting" && awaited.length === 1 && awaited[0] && waiting.every(t => t.waitFor === "someone else") ? `Waiting on ${awaited[0]}` : statusWords(look);
  const earlier = closed.filter(t => !isSameLocalDay(t.completedAt!, now) && now - t.completedAt! < 7 * 86_400_000).slice(0, Math.max(3, 6 - done.length));
  const go = (id: string) => navigate.toThread(id);
  const shortName = shortBotName(bot.name);
  const cont = (task: BotTaskRow) => () => window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: stageTitle(task.title).slice(0, 80) } }));
  const lineOf = (task: BotTaskRow) => {
    const text = stageText(task.line).replace(/^(?:waiting (?:for|on) [^:]{1,40}|with the bot|working|queued|checking):\s*/i, "").replace(/\s*·\s*(?:wakes|next check)\b.*$/i, "").replace(/^\w/, c => c.toUpperCase());
    return text && text.toLowerCase() !== stageTitle(task.title).toLowerCase() ? text : "";
  };
  const hue = botStyle(bot.key, bot.name).hue;
  return <div ref={root} className="bot-panel" data-kind={look.kind} style={{ "--bot-hue": hue } as CSSProperties}>
    <header className="bot-hero">
      <StageFace botKey={bot.key} name={bot.name} pose={look.pose === "idle" && look.badge === "wait" ? "waiting" : look.pose} size={64} />
      <div className="bot-hero-copy">
        <h2>{bot.name}</h2>
        <p className="bot-status">{known || look.kind !== "live" ? headerWords : "\u00a0"}</p>
      </div>
    </header>
    <div className="bot-panel-body">
      {asks.length ? <section aria-label="Asking you">
        <h3>Asking you</h3>
        <div role="list">{asks.map(t => <Row key={t.id} ask title={oneForm(taskAsk(t), stageTitle(t.title), t.needs?.options?.length ?? 0)} meta={stageTitle(t.title)} impact={t.needs?.consequence ?? ""} target={t.needs?.threadId ?? t.conversationThreadId ?? null} here={here} onOpen={go} />)}</div>
      </section> : null}
      <section aria-label="Now">
        <h3>Now</h3>
        {!known && (busyTasks.length || look.kind === "live") ? <p className="bot-quiet" aria-busy="true">{"\u00a0"}</p> : running.length || busyTasks.length ? <div role="list">
          {running.map(a => <Row key={a.threadId} live title={titleOf(a)} meta={a.startedAt != null ? `Started ${ago(a.startedAt, now)}` : "Worker"} target={a.threadId} here={here} onOpen={go} />)}
          {busyTasks.map(t => <Row key={t.id} title={stageTitle(t.title)} meta={busyWords(t, shortName)} detail={lineOf(t)} target={t.conversationThreadId ?? null} here={here} onOpen={go} onContinue={cont(t)} />)}
        </div> : <p className="bot-quiet">{snapshot.chat.has(bot.key) ? `${shortName} is replying in this chat.` : "Nothing running right now."}</p>}
      </section>
      {waiting.length ? <section aria-label="Waiting">
        <h3>Waiting</h3>
        <div role="list">{waiting.map(t => <Row key={t.id} title={stageTitle(t.title)} meta={waitWhen(t, now)} detail={lineOf(t)} target={t.conversationThreadId ?? null} here={here} onOpen={go} onContinue={cont(t)} />)}</div>
      </section> : null}
      <DeskThreads desks={bot.desks} now={now} onOpen={go} />
      {(claims.byBot[bot.key] ?? []).length ? <section aria-label="Started by you">
        <h3>Started by you</h3>
        <div role="list">{(claims.byBot[bot.key] ?? []).map(thread => <Row key={thread.id} title={thread.displayTitle} meta={thread.latestAttentionAt ? `Your chat · active ${ago(thread.latestAttentionAt, now)}` : "Your chat"} target={thread.id} here={here} onOpen={go} />)}</div>
      </section> : null}
      {done.length ? <section aria-label="Done today">
        <h3>Done today</h3>
        <div role="list">
          {done.map(t => <Row key={t.id} done title={stageTitle(t.title)} meta={`${closedWord(t)} ${ago(t.completedAt!, now)}`} detail={t.outcome ? stageText(t.outcome) : ""} target={t.conversationThreadId ?? null} here={here} onOpen={go} />)}
        </div>
      </section> : null}
      {earlier.length ? <section aria-label="Earlier this week">
        <h3>Earlier this week</h3>
        <div role="list">
          {earlier.map(t => <Row key={t.id} done title={stageTitle(t.title)} meta={`${closedWord(t)} ${doneDay(t.completedAt!, now)}`} detail={t.outcome ? stageText(t.outcome) : ""} target={t.conversationThreadId ?? null} here={here} onOpen={go} />)}
        </div>
      </section> : null}
    </div>
  </div>;
}
