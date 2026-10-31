import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { isClosed, layoutBot, needRows, orderedBots, rowStartedAt, shortModel, STATE_LABEL, type BotTasksData, type BotTasksBot, type BotTaskRow, type Attempt } from "@/lib/botTasks";
import { BotTaskFace, openMenuAt, asOf, clockFormatter, clearsWeekdayFormatter, dayMonthFormatter, rowDetail, useDeskPress, type DeskMenu } from "./BotsView";
import { shortBotName } from "./bots";
import { useDispatchWorkers } from "./useDispatchWorkers";
import type { BotTasksState } from "./useBotTasks";

export function dispatchModel(model: string) {
  const family = /(?:^|[-/])(sol|astra|terra|opus|fable)(?:[-/]|$)/i.exec(model)?.[1];
  return family ? family[0].toUpperCase() + family.slice(1).toLowerCase() : shortModel(model);
}
export function elapsed(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`;
}
export function ago(at: number, now: number) {
  const age = elapsed(at, now);
  return age === "now" ? "just now" : `${age} ago`;
}
const BLOCKED = ["offline", "overdue", "retrying"];
export function dispatchSection(bot: BotTasksBot, asks: number, running = 0): string {
  if (asks || bot.tasks.some(t => BLOCKED.includes(t.displayState))) return "Needs attention";
  return running || bot.unlinked.length || bot.tasks.some(t => ["working", "queued"].includes(t.displayState)) ? "In motion" : "On call";
}
function wakeTime(at: number, now: number) {
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = clockFormatter.format(new Date(at));
  return days === 0 ? time : days > 0 && days < 7 ? `${clearsWeekdayFormatter.format(new Date(at))} ${time}` : `${dayMonthFormatter.format(new Date(at))} ${time}`;
}
export function nextStep(bot: BotTasksBot, now: number): string {
  const open = bot.tasks.filter(t => !isClosed(t.displayState));
  if (!open.length) return "";
  const waiting = open.filter(t => t.displayState === "waiting").sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  const first = layoutBot(bot, now).active[0] ?? waiting[0] ?? open[0];
  return [STATE_LABEL[first.displayState], first.displayState === "waiting" && first.wakeAt !== undefined ? `checks ${wakeTime(first.wakeAt, now)}` : "", open.length > 1 ? `+${open.length - 1} more` : ""].filter(Boolean).join(" · ");
}
function MenuTarget({ bot, Menu, onOpen, children }: { bot: BotTasksBot; Menu?: DeskMenu; onOpen: () => void; children: ReactNode }) {
  return Menu ? <Menu bot={bot} onOpenChat={onOpen}>{children}</Menu> : children;
}
function DispatchRow({ bot, question, asks, workers, known, attempts, now, observedAt, current, cue, onChat, onWork, Menu }: {
  bot: BotTasksBot; question?: string; asks: number; workers: Attempt[]; known: boolean; attempts: Record<string, Attempt[]>; now: number; observedAt: number; current: boolean; cue: boolean; onChat: () => void; onWork: () => void; Menu?: DeskMenu;
}) {
  const press = useDeskPress();
  const layout = layoutBot(bot, now);
  const moving = bot.tasks.find(t => !isClosed(t.displayState) && attempts[t.id]?.some(a => a.state === "running")) ?? bot.tasks.find(t => ["working", "queued"].includes(t.displayState));
  const task = layout.needs[0] ?? layout.active.find(t => BLOCKED.includes(t.displayState)) ?? moving ?? layout.active[0] ?? layout.waitingShown[0];
  const blocked = bot.tasks.find(t => BLOCKED.includes(t.displayState));
  const idle = dispatchSection(bot, asks, workers.length) === "On call";
  const step = idle ? nextStep(bot, now) : "";
  const tone = asks ? "ask" : blocked ? "blocked" : idle ? "idle" : "busy";
  const worker = task ? attempts[task.id]?.find(a => a.state === "running") : workers[0];
  const openCount = bot.tasks.filter(t => !isClosed(t.displayState)).length + bot.unlinked.length;
  const last = Math.max(0, ...bot.tasks.map(t => t.completedAt ?? 0));
  const retry = blocked?.retryAt;
  const number = asks ? String(asks) : retry ? new Date(retry).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : known && workers.length ? String(workers.length) : "";
  const unit = asks ? asks === 1 ? "ask" : "asks" : retry ? "retry" : number ? workers.length === 1 ? "worker" : "workers" : "Work";
  return <MenuTarget bot={bot} Menu={Menu} onOpen={onChat}><div className={`dispatch-row dispatch-${tone}${idle ? " dispatch-compact" : ""}`} data-bot={bot.key} {...press}
    onKeyDown={event => { if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); openMenuAt(event.currentTarget); } }}>
    <button className="dispatch-chat" type="button" aria-label={`Open ${bot.name} chat`} aria-current={current ? "page" : undefined} onClick={onChat}>
      <span className={cue ? "dispatch-cue" : ""}><BotTaskFace bot={bot} size={idle ? 32 : 42} state={asks ? "needs-you" : blocked ? "failed" : idle ? undefined : "working"} /></span>
      <span className="dispatch-copy" dir="auto"><span className="dispatch-top"><b>{shortBotName(bot.name)}</b>{task && (asks || blocked) ? <span>{elapsed(rowStartedAt(task, observedAt), now)}</span> : null}</span>
        {question ? <span className="dispatch-quote">“{question}”</span> : idle ? <span className="dispatch-sub">{step || `Idle${last ? ` · done ${ago(last, now)}` : ""}`}</span> : <>
          <span className="dispatch-line">{task?.title || bot.unlinked[0]?.title || "Working"}</span>
          <span className="dispatch-sub">{blocked ? <span className="dispatch-status">Blocked · {rowDetail(blocked, now) || STATE_LABEL[blocked.displayState]}</span> : <>{worker?.model ? <span className="dispatch-model">{dispatchModel(worker.model)}</span> : <span>{task ? STATE_LABEL[task.displayState] : "Working"}</span>}{worker?.startedAt != null ? <span>{elapsed(worker.startedAt, now)}</span> : null}{openCount > 1 ? <span>+{openCount - 1} more</span> : null}</>}</span>
        </>}
      </span>
    </button>
    <button type="button" className="dispatch-work" aria-label={`Show ${shortBotName(bot.name)}'s work`} onClick={onWork}><span className={retry && !asks ? "dispatch-number dispatch-time" : "dispatch-number"}>{number}</span><span>{unit}</span></button>
  </div></MenuTarget>;
}
export function DispatchBoard({ data, state, activeThreadId, isCompactViewport, now, onOpen, onReply, onShowThreads, deskMenu }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string) => void; onReply?: (id: string, text: string) => void; onShowThreads: () => void; deskMenu?: DeskMenu;
}) {
  const needs = needRows(data);
  const snapshot = useDispatchWorkers(data);
  const sections = ["Needs attention", "In motion", "On call"];
  const sectionOf = (bot: BotTasksBot) => dispatchSection(bot, needs.filter(n => n.botKey === bot.key).length, snapshot.byBot[bot.key]?.length ?? 0);
  const arranged = sections.map(name => ({ name, bots: orderedBots(data).filter(bot => sectionOf(bot) === name).map(bot => bot.key) }));
  const loaded = data.bots.every(bot => bot.key in snapshot.byBot);
  const signatures = Object.fromEntries(data.bots.map(bot => [bot.key, `${sectionOf(bot)}:${layoutBot(bot, now).mood}`]));
  const previous = useRef({ loaded, signatures });
  const [cues, setCues] = useState<string[]>([]);
  const signature = JSON.stringify({ loaded, signatures });
  useEffect(() => {
    const next: { loaded: boolean; signatures: Record<string, string> } = JSON.parse(signature);
    const changed = previous.current.loaded === next.loaded ? Object.keys(next.signatures).filter(key => previous.current.signatures[key] !== undefined && previous.current.signatures[key] !== next.signatures[key]) : [];
    previous.current = next;
    if (!changed.length) return;
    setCues(changed);
    const timer = setTimeout(() => setCues([]), 550);
    return () => clearTimeout(timer);
  }, [signature]);
  const [frozen, setFrozen] = useState<typeof arranged | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setSheet(null); opener.current?.focus(); };
  const navigate = (id: string, answer?: string) => {
    flushSync(() => setSheet(null));
    opener.current?.focus();
    if (answer !== undefined && onReply) onReply(id, answer); else onOpen(id);
  };
  const root = useRef<HTMLDivElement>(null);
  const panelPress = useDeskPress();
  const showMenu = (key: string, x?: number, y?: number) => {
    flushSync(() => setSheet(null));
    opener.current?.focus();
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>(".dispatch-row") ?? []).find(node => node.dataset.bot === key);
    if (row) openMenuAt(row, x, y);
  };
  useEffect(() => {
    if (!sheet || !isCompactViewport) return;
    const elements = [document.documentElement, document.body, root.current?.closest<HTMLElement>(".radar-list-body")].filter((node): node is HTMLElement => !!node);
    const previous = elements.map(node => node.style.overflow);
    elements.forEach(node => { node.style.overflow = "hidden"; });
    return () => elements.forEach((node, i) => { node.style.overflow = previous[i]; });
  }, [sheet, isCompactViewport]);
  useEffect(() => {
    const release = () => setTimeout(() => setFrozen(null), 0);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release); };
  }, []);
  useEffect(() => { if (sheet) panel.current?.focus(); }, [sheet]);
  useEffect(() => { if (sheet && !data.bots.some(b => b.key === sheet)) close(); }, [data.bots, sheet]);
  const bot = data.bots.find(b => b.key === sheet);
  const blockedCount = data.bots.filter(b => b.tasks.some(t => BLOCKED.includes(t.displayState))).length;
  const totalWorkers = Object.values(snapshot.byBot).reduce((n, rows) => n + rows.length, 0);
  const tally = [needs.length ? `${needs.length} needs you` : "", blockedCount ? `${blockedCount} blocked` : "", snapshot.known.size === data.bots.length && totalWorkers ? `${totalWorkers} ${totalWorkers === 1 ? "worker" : "workers"}` : ""].filter(Boolean).join(" · ");
  const tasks = bot?.tasks.filter(t => !isClosed(t.displayState)) ?? [];
  const recent = bot?.tasks.filter(t => isClosed(t.displayState)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)) ?? [];
  const ownNeeds = needs.filter(n => n.botKey === sheet);
  const workerCount = bot && snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null;
  const drag = useRef<number | null>(null);
  const taskRow = (task: BotTaskRow) => <div key={task.id} className="dispatch-task-group"><button type="button" className="dispatch-task" aria-current={task.conversationThreadId === activeThreadId ? "page" : undefined} onClick={() => navigate(task.conversationThreadId ?? bot!.coordinatorThreadId)}><b dir="auto">{task.title}</b><span>{STATE_LABEL[task.displayState]}{rowDetail(task, now) ? ` · ${rowDetail(task, now)}` : ""}</span></button>{snapshot.byTask[task.id]?.map(a => <button type="button" className="dispatch-attempt" key={a.threadId} onClick={() => navigate(a.threadId)} aria-label={`Open worker ${a.title || a.threadId}`}><span>{a.model ? <span className="dispatch-model">{dispatchModel(a.model)}</span> : "Worker"} · {a.state === "running" ? "Running" : a.state}{a.startedAt != null ? ` · ${elapsed(a.startedAt, a.endedAt ?? now)}` : ""}</span></button>)}</div>;
  return <div className="dispatch" ref={root} onPointerDownCapture={() => setFrozen(arranged)}>
    {state.cached || state.status === "error" ? <p role="status">Saved view · as of {asOf(data.observedAt, now)} · reconnecting</p> : null}
    <p className="dispatch-tally">{tally || "Nothing needs you"}</p>
    {(frozen ?? arranged).map(section => section.bots.length ? <section key={section.name} aria-label={section.name}><header className="dispatch-heading"><h3>{section.name}</h3><span>{section.bots.length}</span></header>{section.bots.map(key => {
      const b = data.bots.find(b => b.key === key);
      if (!b) return null;
      const asks = needs.filter(n => n.botKey === key);
      return <DispatchRow key={key} bot={b} asks={asks.length} question={asks[0]?.question} workers={snapshot.byBot[key] ?? []} known={snapshot.known.has(key)} attempts={snapshot.byTask} now={now} observedAt={data.observedAt} cue={cues.includes(key)} current={activeThreadId === b.coordinatorThreadId} onChat={() => onOpen(b.coordinatorThreadId)} onWork={() => { opener.current = document.activeElement as HTMLElement; setSheet(key); }} Menu={deskMenu} />;
    })}</section> : null)}
    <p className="dispatch-legend">Row opens chat · number opens work · hold for menu</p>
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · Threads</button> : null}
    {bot ? createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}`} onClick={event => { if (event.target === event.currentTarget) close(); }}><div className="dispatch-panel" {...panelPress} onContextMenu={event => {
      panelPress.onContextMenu(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      showMenu(bot.key, event.clientX, event.clientY);
    }} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: work`} onKeyDown={event => {
      if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); showMenu(bot.key); }
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") { const buttons = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')); const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}>
      <button className="dispatch-grabber" aria-label="Close work panel" onClick={close} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) close(); drag.current = null; }}><span /></button>
      <header className="dispatch-panel-head"><BotTaskFace bot={bot} size={42} state={ownNeeds.length ? "needs-you" : tasks.some(t => BLOCKED.includes(t.displayState)) ? "failed" : sectionOf(bot) === "In motion" ? "working" : undefined} /><div><h2>{shortBotName(bot.name)}</h2><p>{[workerCount ? `${workerCount} ${workerCount === 1 ? "worker" : "workers"}` : "", tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : bot.unlinked.length ? `${bot.unlinked.length} unfiled` : "Nothing running"].filter(Boolean).join(" · ")}</p></div><button className="dispatch-chat-pill" onClick={() => navigate(bot.coordinatorThreadId)}>Chat</button><button onClick={() => showMenu(bot.key)}>More</button></header>
      <div className="dispatch-panel-body">{ownNeeds.map(need => <div className="dispatch-ask-card" key={need.key}><span>Needs you</span><button className="dispatch-question" dir="auto" disabled={!need.threadId} onClick={() => need.threadId && navigate(need.threadId)}>“{need.question}”</button>{need.options.map(option => <button key={option} onClick={() => { if (need.threadId) { navigate(need.threadId, option); } }}>{option}</button>)}</div>)}
      {tasks.filter(t => BLOCKED.includes(t.displayState)).map(t => <div className="dispatch-block-card" key={t.id}><b>Blocked · {t.title}</b><p>{rowDetail(t, now) || STATE_LABEL[t.displayState]}{t.retryAt ? ` · Retry ${new Date(t.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</p></div>)}
      {tasks.length || bot.unlinked.length ? <><h3>Tasks</h3>{tasks.map(taskRow)}{bot.unlinked.map(w => <button className="dispatch-task" key={w.threadId} onClick={() => navigate(w.threadId)}><b>{w.title || "Worker"}</b><span>Work without a task</span></button>)}</> : <p className="dispatch-idle">Nothing running{recent[0]?.completedAt ? ` · last completed ${ago(recent[0].completedAt, now)}` : ""}</p>}
      <h3>Recent</h3>{recent.length ? recent.map(taskRow) : <p className="dispatch-idle">No recent tasks</p>}
      </div>
    </div></div>, document.body) : null}
  </div>;
}
