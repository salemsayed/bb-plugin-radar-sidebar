import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { isClosed, layoutBot, orderedBots, rowStartedAt, shortModel, STATE_LABEL, type BotTasksData, type BotTasksBot, type BotTaskRow, type Attempt } from "@/lib/botTasks";
import { BotTaskFace, openMenuAt, asOf, clearsLine, clockFormatter, clearsWeekdayFormatter, rowDetail, useDeskPress, type DeskMenu } from "./BotsView";
import { botStyle, shortBotName } from "./bots";
import { automationsHref } from "./automationsLink";
import { plainNote, splitStatus, stateTone, taskHeadline } from "./workText";
import { Icon } from "@/components/ui/icon";
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
export const IN_CHAT = "Working in chat";
export function dispatchSection(bot: BotTasksBot, running = 0, chatting = false): string {
  if (bot.tasks.some(t => BLOCKED.includes(t.displayState))) return "In motion";
  return running || chatting || bot.unlinked.length || bot.tasks.some(t => ["working", "queued"].includes(t.displayState)) ? "In motion" : "On call";
}
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
export function checksLine(at: number, now: number) {
  if (at < now) return clearsLine(at, now);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = clockFormatter.format(new Date(at));
  return `checks ${days === 0 ? time : days === 1 ? `tomorrow ${time}` : days < 7 ? `${clearsWeekdayFormatter.format(new Date(at))} ${time}` : `${dateFormatter.format(new Date(at))} ${time}`}`;
}
function dayAndTime(at: number, now: number) {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `today ${clockFormatter.format(new Date(at))}` : days === 1 ? `yesterday ${clockFormatter.format(new Date(at))}` : dateFormatter.format(new Date(at));
}
export function taskStatus(task: BotTaskRow, now: number): string {
  if (task.displayState === "waiting" && task.wakeAt !== undefined) return `${STATE_LABEL.waiting} · ${checksLine(task.wakeAt, now)}`;
  const detail = rowDetail(task, now);
  if (!isClosed(task.displayState)) return [STATE_LABEL[task.displayState], detail].filter(Boolean).join(" · ");
  const parts = detail ? detail.split(" · ") : [];
  const label = /^(Cancelled|Stopped)\b/.test(parts[0] ?? "") ? parts.shift()! : STATE_LABEL[task.displayState];
  return [label, task.completedAt !== undefined ? dayAndTime(task.completedAt, now) : "", ...parts].filter(Boolean).join(" · ");
}
export function attemptStatus(attempt: Attempt, now: number): string {
  if (attempt.state === "running") return attempt.startedAt != null ? `running ${elapsed(attempt.startedAt, now)}` : "running";
  if (attempt.state === "unknown") return "";
  return attempt.endedAt != null && elapsed(attempt.endedAt, now) !== "now" ? `${attempt.state} ${elapsed(attempt.endedAt, now)}` : attempt.state;
}
export function panelSummary(tasks: BotTaskRow[], workers: number | null, unfiled: number, chatting = false): string {
  const needs = tasks.filter(task => task.displayState === "needs").length;
  return [workers ? `${workers} ${workers === 1 ? "worker" : "workers"}` : "", tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : "", needs ? `${needs} ${STATE_LABEL.needs.toLowerCase()}` : "", unfiled ? `${unfiled} unfiled` : ""].filter(Boolean).join(" · ") || (chatting ? IN_CHAT : "Nothing running");
}
export function nextStep(bot: BotTasksBot, now: number): string {
  const open = bot.tasks.filter(t => !isClosed(t.displayState));
  if (!open.length) return "";
  const waiting = open.filter(t => t.displayState === "waiting").sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  const first = layoutBot(bot, now).active[0] ?? waiting[0] ?? open[0];
  return [STATE_LABEL[first.displayState], first.displayState === "waiting" && first.wakeAt !== undefined ? checksLine(first.wakeAt, now) : "", open.length > 1 ? `+${open.length - 1} more` : ""].filter(Boolean).join(" · ");
}
function MenuTarget({ bot, Menu, onOpen, children }: { bot: BotTasksBot; Menu?: DeskMenu; onOpen: () => void; children: ReactNode }) {
  return Menu ? <Menu bot={bot} onOpenChat={onOpen}>{children}</Menu> : children;
}
function DispatchRow({ bot, workers, known, chatting, attempts, now, observedAt, current, cue, unread, onChat, onWork, Menu }: {
  bot: BotTasksBot; workers: Attempt[]; known: boolean; chatting: boolean; attempts: Record<string, Attempt[]>; now: number; observedAt: number; current: boolean; cue: boolean; unread: boolean; onChat: () => void; onWork: () => void; Menu?: DeskMenu;
}) {
  const press = useDeskPress();
  const layout = layoutBot(bot, now);
  const runs = (a: Attempt) => a.state === "running" && a.threadId !== bot.coordinatorThreadId;
  const moving = bot.tasks.find(t => !isClosed(t.displayState) && attempts[t.id]?.some(runs)) ?? bot.tasks.find(t => ["working", "queued"].includes(t.displayState));
  const coordinating = bot.tasks.find(t => !isClosed(t.displayState) && attempts[t.id]?.some(a => a.state === "running" && a.threadId === bot.coordinatorThreadId));
  const inChat = chatting && !moving && !bot.unlinked.length;
  const task = layout.needs[0] ?? layout.active.find(t => BLOCKED.includes(t.displayState)) ?? moving ?? (inChat ? coordinating : layout.active[0] ?? layout.waitingShown[0]);
  const blocked = bot.tasks.find(t => BLOCKED.includes(t.displayState));
  const idle = dispatchSection(bot, workers.length, chatting) === "On call";
  const step = idle ? nextStep(bot, now) : "";
  const tone = blocked ? "blocked" : idle ? "idle" : "busy";
  const worker = task ? attempts[task.id]?.find(runs) : workers[0];
  const openCount = bot.tasks.filter(t => !isClosed(t.displayState)).length + bot.unlinked.length;
  const last = Math.max(0, ...bot.tasks.map(t => t.completedAt ?? 0));
  const retry = blocked?.retryAt;
  const number = retry ? new Date(retry).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : known && workers.length ? String(workers.length) : "";
  const unit = retry ? "retry" : workers.length === 1 ? "worker" : "workers";
  const spoken = !number ? "" : retry ? `, retry ${number}` : `, ${number} ${unit}`;
  return <MenuTarget bot={bot} Menu={Menu} onOpen={onChat}><div className={`dispatch-row dispatch-${tone}${idle ? " dispatch-compact" : ""}${unread ? " dispatch-unread" : ""}`} data-bot={bot.key} {...press}
    onKeyDown={event => { if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); openMenuAt(event.currentTarget); } }}>
    <button className="dispatch-chat" type="button" aria-label={`Open ${bot.name} chat${unread ? ", unread reply" : ""}`} aria-current={current ? "page" : undefined} onClick={onChat}>
      <span className={cue ? "dispatch-face dispatch-cue" : "dispatch-face"}><BotTaskFace bot={bot} size={idle ? 32 : 42} state={blocked ? "failed" : idle ? undefined : "working"} />{unread ? <span className="dispatch-unread-dot" aria-hidden="true" /> : null}</span>
      <span className="dispatch-copy" dir="auto"><span className="dispatch-top"><b>{shortBotName(bot.name)}</b>{task && blocked ? <span>{elapsed(rowStartedAt(task, observedAt), now)}</span> : null}</span>
        {idle ? <span className="dispatch-sub">{step || `Idle${last ? ` · done ${ago(last, now)}` : ""}`}</span> : <>
          <span className="dispatch-line">{task?.title || (inChat ? IN_CHAT : bot.unlinked[0]?.title || "Working")}</span>
          <span className="dispatch-sub">{blocked ? <span className="dispatch-status">Blocked · {rowDetail(blocked, now) || STATE_LABEL[blocked.displayState]}</span> : inChat && !task ? nextStep(bot, now) ? <span>{nextStep(bot, now)}</span> : null : <>{worker?.model ? <span className="dispatch-model">{dispatchModel(worker.model)}</span> : <span>{task ? STATE_LABEL[task.displayState] : "Working"}</span>}{worker?.startedAt != null ? <span>{elapsed(worker.startedAt, now)}</span> : null}{openCount > 1 ? <span>+{openCount - 1} more</span> : null}</>}</span>
        </>}
      </span>
    </button>
    <button type="button" className="dispatch-work" aria-label={`Show ${shortBotName(bot.name)}'s work${spoken}`} onClick={onWork}>{number ? <><span className={retry ? "dispatch-number dispatch-time" : "dispatch-number"}>{number}</span><span>{unit}</span></> : <Icon name="ChevronRight" aria-hidden="true" className="dispatch-chevron" />}</button>
  </div></MenuTarget>;
}
export function DispatchBoard({ data, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads, deskMenu, unreadChats }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string) => void; onShowThreads: () => void; deskMenu?: DeskMenu; unreadChats?: ReadonlySet<string>;
}) {
  const snapshot = useDispatchWorkers(data);
  const sections = ["In motion", "On call"];
  const sectionOf = (bot: BotTasksBot, running = snapshot.byBot[bot.key]?.length ?? 0, chatting = snapshot.chat.has(bot.key)) => dispatchSection(bot, running, chatting);
  const arranged = sections.map(name => ({ name, bots: orderedBots(data).filter(bot => sectionOf(bot) === name).map(bot => bot.key) }));
  const signatures = Object.fromEntries(data.bots.map(bot => [bot.key, { look: `${sectionOf(bot)}:${layoutBot(bot, now).mood}`, idle: sectionOf(bot, 0, false), loaded: bot.key in snapshot.byBot }]));
  const previous = useRef(signatures);
  const [cues, setCues] = useState<string[]>([]);
  const signature = JSON.stringify(signatures);
  useEffect(() => {
    const next: typeof signatures = JSON.parse(signature);
    const changed = Object.keys(next).filter(key => {
      const before = previous.current[key];
      return before && before.look !== next[key].look && (before.loaded || !next[key].loaded || before.idle !== next[key].idle);
    });
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
  const navigate = (id: string) => {
    flushSync(() => setSheet(null));
    opener.current?.focus();
    onOpen(id);
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
  const tally = blockedCount ? `${blockedCount} blocked` : "";
  const tasks = bot?.tasks.filter(t => !isClosed(t.displayState)) ?? [];
  const recent = bot?.tasks.filter(t => isClosed(t.displayState)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)) ?? [];
  const workerCount = bot && snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null;
  const drag = useRef<number | null>(null);
  const workerName = (a: Attempt) => a.model ? `${dispatchModel(a.model)} worker` : "Worker";
  const workerLabel = (a: Attempt, status: string) => `Open worker ${a.title || a.threadId}: ${workerName(a)}${status ? `, ${status}` : ""}`;
  const taskRow = (task: BotTaskRow) => {
    const status = taskStatus(task, now);
    const { state, meta, note } = splitStatus(status);
    const tone = /^(Cancelled|Stopped)\b/.test(state) ? "ended" : stateTone(task.displayState);
    const headline = taskHeadline(task.title);
    const attempts = snapshot.byTask[task.id] ?? [];
    const running = attempts.filter(a => a.state === "running");
    const resting = attempts.filter(a => a.state !== "running");
    const restingSummary = Object.entries(resting.reduce<Record<string, number>>((n, a) => ({ ...n, [a.state === "unknown" ? "other" : a.state]: (n[a.state === "unknown" ? "other" : a.state] ?? 0) + 1 }), {})).map(([word, n]) => `${n} ${word}`).join(" · ");
    const clipped = headline !== task.title.trim().replace(/\s+/g, " ");
    const shortNote = note ? plainNote(note) : "";
    return <article key={task.id} className="dispatch-task-group" data-tone={tone}>
      <button type="button" className="dispatch-task" aria-current={task.conversationThreadId === activeThreadId ? "page" : undefined} onClick={() => navigate(task.conversationThreadId ?? bot!.coordinatorThreadId)}>
        <span className="dispatch-status-line"><i aria-hidden="true" />{state}{meta ? ` · ${meta}` : ""}</span>
        <b dir="auto">{headline}</b>
        {task.ask ? <span className="dispatch-ask-source">{task.ask.label}</span> : null}
        {task.outcome ? <span className="dispatch-ask-outcome" dir="auto">{task.outcome}</span> : null}
        {shortNote ? <span className="dispatch-note" dir="auto">{shortNote}</span> : null}
      </button>
      <button type="button" className="dispatch-task-continue" onClick={() => {
        window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot!.coordinatorThreadId, taskId: task.id, label: task.title.slice(0, 80) } }));
        navigate(bot!.coordinatorThreadId);
      }}>Continue</button>
      {running.length ? <div className="dispatch-workers">{running.map(a => {
        const s = attemptStatus(a, now);
        return <button type="button" className="dispatch-attempt dispatch-worker-chip" key={a.threadId} onClick={() => navigate(a.threadId)} aria-label={workerLabel(a, s)}><i aria-hidden="true" /><span className="dispatch-worker-model">{a.model ? dispatchModel(a.model) : "Worker"}</span>{s ? ` · ${s}` : ""}</button>;
      })}</div> : null}
      {clipped || note || attempts.length ? <details className="dispatch-details">
        <summary>Details{restingSummary ? <span> · {restingSummary}</span> : null}<Icon name="ChevronDown" aria-hidden="true" /></summary>
        {clipped ? <p className="dispatch-full" dir="auto">{task.title}</p> : null}
        {note ? <p className="dispatch-full-status" dir="auto">{status}</p> : null}
        {attempts.length ? <ul className="dispatch-worker-list">{attempts.map(a => {
          const s = attemptStatus(a, now);
          return <li key={a.threadId}><button type="button" className="dispatch-attempt" onClick={() => navigate(a.threadId)} aria-label={`${workerLabel(a, s)} (${a.threadId})`}>
            <span className="dispatch-attempt-head"><i aria-hidden="true" data-running={a.state === "running" || undefined} /><span className="dispatch-worker-model">{workerName(a)}</span>{s ? ` · ${s}` : ""}</span>
            {a.title ? <span className="dispatch-attempt-title" dir="auto">{a.title}</span> : null}
            <code>{a.threadId}</code>
          </button></li>;
        })}</ul> : null}
      </details> : null}
    </article>;
  };
  const hue = bot ? botStyle(bot.key, bot.name).hue : 0;
  const pluginScope = root.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin") ?? undefined;
  return <div className="dispatch" ref={root} onPointerDownCapture={() => setFrozen(arranged)}>
    {state.cached || state.status === "error" ? <p role="status">Saved view · as of {asOf(data.observedAt, now)} · reconnecting</p> : null}
    {tally ? <p className="dispatch-tally">{tally}</p> : null}
    {(frozen ?? arranged).map(section => section.bots.length ? <section key={section.name} aria-label={section.name}><header className="dispatch-heading"><h3>{section.name}</h3><span>{section.bots.length}</span></header>{section.bots.map(key => {
      const b = data.bots.find(b => b.key === key);
      if (!b) return null;
      return <DispatchRow key={key} bot={b} workers={snapshot.byBot[key] ?? []} known={snapshot.known.has(key)} chatting={snapshot.chat.has(key)} attempts={snapshot.byTask} now={now} observedAt={data.observedAt} cue={cues.includes(key)} unread={!!unreadChats?.has(b.coordinatorThreadId) && activeThreadId !== b.coordinatorThreadId} current={activeThreadId === b.coordinatorThreadId} onChat={() => onOpen(b.coordinatorThreadId)} onWork={() => { opener.current = document.activeElement as HTMLElement; setSheet(key); }} Menu={deskMenu} />;
    })}</section> : null)}
    <p className="dispatch-legend">Open chat · View work · Menu: hold or right-click</p>
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · Threads</button> : null}
    {bot ? createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}`} data-bb-portaled-overlay="" data-bb-plugin={pluginScope} onClick={event => { if (event.target === event.currentTarget) close(); }}><div className="dispatch-panel" style={{ "--bot-hue": hue } as CSSProperties} {...panelPress} onContextMenu={event => {
      panelPress.onContextMenu(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      showMenu(bot.key, event.clientX, event.clientY);
    }} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: work`} onKeyDown={event => {
      if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); showMenu(bot.key); }
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") { const buttons = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => { const closed = node.closest("details:not([open])"); return !closed || node.parentElement === closed && node.tagName === "SUMMARY"; }).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}>
      {isCompactViewport ? <button className="dispatch-grabber" aria-label="Close work panel" onClick={close} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) close(); drag.current = null; }}><span /></button> : null}
      <header className="dispatch-panel-head"><span className="dispatch-panel-face"><BotTaskFace bot={bot} size={40} state={tasks.some(t => BLOCKED.includes(t.displayState)) ? "failed" : sectionOf(bot) === "In motion" ? "working" : undefined} /></span><div><h2>{shortBotName(bot.name)}</h2><p>{panelSummary(tasks, workerCount, bot.unlinked.length, snapshot.chat.has(bot.key))}</p></div>{isCompactViewport ? null : <button className="dispatch-close" aria-label="Close" onClick={close}><Icon name="X" aria-hidden="true" /></button>}</header>
      <nav className="dispatch-panel-actions" aria-label={`${shortBotName(bot.name)} actions`}>
        <button className="dispatch-chat-pill" onClick={() => navigate(bot.coordinatorThreadId)}><Icon name="MessageSquare" aria-hidden="true" />Chat</button>
        <a className="dispatch-automations" href={automationsHref(bot.key)} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setSheet(null); }}><Icon name="Clock" aria-hidden="true" />Automations</a>
        <button className="dispatch-more" onClick={() => showMenu(bot.key)}><Icon name="MoreHorizontal" aria-hidden="true" />More</button>
      </nav>
      <div className="dispatch-panel-body">
      {tasks.filter(t => BLOCKED.includes(t.displayState)).map(t => <div className="dispatch-block-card" key={t.id}><b dir="auto">Blocked · {taskHeadline(t.title)}</b><p>{rowDetail(t, now) || STATE_LABEL[t.displayState]}{t.retryAt ? ` · Retry ${new Date(t.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</p></div>)}
      {tasks.length || bot.unlinked.length ? <><header className="dispatch-section-head"><h3>Tasks</h3><span>{tasks.length + bot.unlinked.length}</span></header><div className="dispatch-open">{tasks.map(taskRow)}{bot.unlinked.map(w => <article className="dispatch-task-group" data-tone="busy" key={w.threadId}><button className="dispatch-task" onClick={() => navigate(w.threadId)}><span className="dispatch-status-line"><i aria-hidden="true" />Work without a task</span><b dir="auto">{taskHeadline(w.title || "Worker")}</b></button></article>)}</div></> : <p className="dispatch-idle">{snapshot.chat.has(bot.key) ? IN_CHAT : "Nothing running"}{recent[0]?.completedAt ? ` · last completed ${ago(recent[0].completedAt, now)}` : ""}</p>}
      <header className="dispatch-section-head"><h3>Recent</h3>{recent.length ? <span>{recent.length}</span> : null}</header>{recent.length ? <div className="dispatch-recent">{recent.map(taskRow)}</div> : <p className="dispatch-idle">No recent tasks</p>}
      </div>
    </div></div>, document.body) : null}
  </div>;
}
