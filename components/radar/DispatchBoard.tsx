import { DeskThreads } from "./DeskThreads";
import { ClaimedThreads, useThreadClaims } from "./useThreadClaims";
import { ThreadsSection } from "./ThreadsSection";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { deskBadge, isClosed, layoutBot, orderedBots, rowStartedAt, shortModel, STATE_LABEL, type BotTasksData, type BotTasksBot, type BotTaskRow, type Attempt } from "@/lib/botTasks";
import { BotTaskFace, asOf, clearsLine, clockFormatter, clearsWeekdayFormatter, rowDetail, useDeskPress, type DeskMenu } from "./BotsView";
import { botStyle, shortBotName } from "./bots";
import { automationsHref } from "./automationsLink";
import { askLine, cardOrder, stateTone, taskHeadline, youWords } from "./workText";
import { Icon } from "@/components/ui/icon";
import { useDispatchWorkers, type WorkerSnapshot } from "./useDispatchWorkers";
import { experimental_ThreadActionsMenu as ThreadActionsMenu } from "@get-bb/plugin-sdk/app";
import { useCoordinatorTarget } from "./BotDeskMenu";
import { StageFace } from "./StageFace";
import { rowLook, stageText, stageTitle, type RowLook } from "./stage";
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
const CHECKING = /not checked|checks needed|check failed|hasn't (?:checked|closed|finished)|evidence needs review|owner review/i;
export function cardStatus(task: BotTaskRow, running: Attempt[], now: number): string {
  const state = task.displayState;
  if (state === "needs") {
    const ask = stageText(task.needs?.question ?? task.line).replace(/^(?:needs you|waiting for you)\s*[:·-]\s*/i, "");
    return ask ? `Waiting on you: ${ask}` : "Waiting on you";
  }
  if (state === "working" || state === "retrying" && running.length) {
    const first = [...running].sort((a, b) => (a.startedAt ?? now) - (b.startedAt ?? now))[0];
    if (!first) return "Bot working";
    const who = first.model ? dispatchModel(first.model) : "Worker";
    return [`${who} working`, first.startedAt != null ? elapsed(first.startedAt, now) : "", running.length > 1 ? `+${running.length - 1} more` : ""].filter(Boolean).join(" · ");
  }
  if (isClosed(state)) return taskStatus(task, now).split(" · ").slice(0, 2).join(" · ");
  if (state === "waiting" && task.wakeAt !== undefined) {
    const when = checksLine(task.wakeAt, now);
    const line = when.startsWith("checks ") ? `Checks ${when.slice(7)}` : `Check ${when}`;
    return task.waitFor === "someone else" ? `Waiting on others · ${line.toLowerCase()}` : line;
  }
  const line = task.line;
  if (/^Its machine is off/.test(line)) return "Machine off · resumes when it is back";
  if (/^Queued/.test(line)) return task.retryAt ? `Queued · retry ${clockFormatter.format(new Date(task.retryAt))}` : "Queued";
  if (/^Retrying/.test(line)) return "Retrying after an error";
  if (/^Wake was due/.test(line) || state === "overdue") return "Check overdue";
  if (/^Filed\. Not started/.test(line) || state === "ready") return "Not started";
  if (/^With the bot/.test(line)) return "With the bot";
  if (CHECKING.test(line) || state === "checking") return "Result waits for the bot's check";
  if (task.waitFor === "someone else") return "Waiting on others · no date";
  if (state === "offline") return "Machine off";
  if (state === "queued") return "Queued";
  return "Waiting · no date";
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
export interface PanelAnchor { x: number; y: number; align?: "start" | "end" }

const BADGE_WORDS: Record<string, string> = { ask: "asking you", wait: "waiting", unread: "new reply", blocked: "stuck" };

function panelAnchor(row: HTMLElement, y: number): PanelAnchor {
  const box = row.getBoundingClientRect();
  const side = row.closest(".stage")?.getBoundingClientRect().right ?? box.right;
  return { x: side + 8, y };
}

function StageRow({ bot, look, current, onChat, onShowWork, onShowDesks }: {
  bot: BotTasksBot; look: RowLook; current: boolean; onChat: () => void; onShowWork: (anchor: PanelAnchor) => void; onShowDesks: (anchor: PanelAnchor) => void;
}) {
  const press = useDeskPress();
  const name = shortBotName(bot.name);
  const desks = deskBadge(bot.desks);
  const desksLabel = desks ? `${desks.count} ${desks.count === 1 ? "desk needs" : "desks need"} you` : "";
  const spoken = [look.badge ? BADGE_WORDS[look.badge] : "", look.line, look.extra].filter(Boolean).join(", ");
  return <div className="stage-row" data-bot={bot.key} data-tone={look.tone} data-kind={look.kind}
      style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties} {...press}
      onContextMenu={event => {
        press.onContextMenu(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onShowWork(panelAnchor(event.currentTarget, Math.max(event.currentTarget.getBoundingClientRect().top, event.clientY - 40)));
      }}
      onKeyDown={event => {
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
          event.preventDefault();
          onShowWork(panelAnchor(event.currentTarget, event.currentTarget.getBoundingClientRect().top));
        }
      }}>
      <button type="button" className="stage-chat" aria-current={current ? "page" : undefined} aria-label={`${name}: ${[spoken, desksLabel].filter(Boolean).join(", ")}. Open chat`} onClick={onChat}>
        <span className="stage-figure">
          <StageFace botKey={bot.key} name={bot.name} pose={look.pose} />
          {look.badge && look.kind === "calm" ? <span className="stage-badge" data-badge={look.badge} aria-hidden="true" /> : null}
        </span>
        <span className="stage-copy">
          <span className="stage-head"><b>{name}</b>{look.time ? <span className="stage-time">{look.time}</span> : null}</span>
          <span className="stage-line"><bdi>{look.line}</bdi>{look.extra ? <> <span className="stage-extra" dir="ltr">{look.extra}</span></> : null}</span>
        </span>
      </button>
      {desks ? <button type="button" className="stage-desk-badge" data-tone={desks.tone} aria-label={`${desksLabel}. Open ${name}'s desks`} title={`${desksLabel}: open desks`}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          const row = event.currentTarget.closest<HTMLElement>(".stage-row") ?? event.currentTarget;
          onShowDesks(panelAnchor(row, row.getBoundingClientRect().top));
        }}>
        <span className="stage-desk-count">{desks.count}</span><span className="stage-desk-word">{desks.count === 1 ? "desk" : "desks"}</span>
      </button> : null}
    </div>;
}

export function DispatchBoard({ data, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads, unreadChats }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string) => void; onShowThreads: () => void; deskMenu?: DeskMenu; unreadChats?: ReadonlySet<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisibleSurface(root);
  const snapshot = useDispatchWorkers(data, visible);
  const [sheet, setSheet] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PanelAnchor | undefined>(undefined);
  const [focusDesks, setFocusDesks] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = () => { setSheet(null); opener.current?.focus(); };
  useEffect(() => { if (sheet && !data.bots.some(b => b.key === sheet)) setSheet(null); }, [data.bots, sheet]);
  const bot = data.bots.find(b => b.key === sheet);
  return <div className="stage" ref={root}>
    {state.cached || state.status === "error" ? <p className="stage-stale" role="status">Bots core isn't answering. Showing what we knew at {asOf(data.observedAt, now)}.</p> : null}
    {orderedBots(data).map(b => {
      const unread = !!unreadChats?.has(b.coordinatorThreadId) && activeThreadId !== b.coordinatorThreadId;
      const workers = snapshot.byBot[b.key] ?? [];
      const look = rowLook(b, { running: workers.length, runningTitle: workers[0]?.title, failedChecks: snapshot.failedChecks, chatting: snapshot.chat.has(b.key), unread, now });
      return <StageRow key={b.key} bot={b} look={look} current={activeThreadId === b.coordinatorThreadId}
        onChat={() => onOpen(b.coordinatorThreadId)}
        onShowWork={point => { opener.current = document.activeElement as HTMLElement; setAnchor(point); setFocusDesks(false); setSheet(b.key); }}
        onShowDesks={point => { opener.current = document.activeElement as HTMLElement; setAnchor(point); setFocusDesks(true); setSheet(b.key); }} />;
    })}
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · All threads</button> : null}
    <ThreadsSection activeThreadId={activeThreadId} now={now} onOpen={onOpen} />
    {bot ? <BotWorkPanel key={`${bot.key}:${focusDesks}`} bot={bot} anchor={anchor} focusDesks={focusDesks} snapshot={snapshot} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
      onShowThreads={onShowThreads}
      scope={root.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin") ?? undefined}
      onNavigate={id => { flushSync(() => setSheet(null)); opener.current?.focus(); onOpen(id); }} onClose={close} /> : null}
  </div>;
}

const PANEL_WIDTH = 400;
const EDGE = 12;

function anchoredStyle(anchor: PanelAnchor): CSSProperties {
  const left = anchor.align === "end" ? anchor.x - PANEL_WIDTH : anchor.x;
  return {
    position: "fixed",
    left: `clamp(${EDGE}px, ${left}px, calc(100vw - ${PANEL_WIDTH + EDGE}px))`,
    top: `clamp(${EDGE}px, ${anchor.y}px, calc(100dvh - ${EDGE}px - min(80dvh, calc(100dvh - 100px))))`,
  };
}

export function BotWorkPanel({ bot, anchor, focusDesks = false, snapshot, activeThreadId, isCompactViewport, now, scope, onNavigate, onClose, onShowThreads }: {
  bot: BotTasksBot; anchor?: PanelAnchor; focusDesks?: boolean; snapshot: WorkerSnapshot; activeThreadId: string | null; isCompactViewport: boolean; now: number; scope?: string;
  onNavigate: (id: string) => void; onClose: () => void; onShowThreads?: () => void;
}) {
  const claims = useThreadClaims();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const desksRef = useRef<HTMLElement>(null);
  const target = useCoordinatorTarget(bot.coordinatorThreadId);
  const drag = useRef<number | null>(null);
  const [openAsks, setOpenAsks] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const section = desksRef.current;
    if (!focusDesks || !section || !body.current) { panel.current?.focus(); return; }
    body.current.scrollTop += section.getBoundingClientRect().top - body.current.getBoundingClientRect().top - 4;
    (section.querySelector<HTMLElement>(".radar-desk-row:not(:disabled)") ?? panel.current)?.focus({ preventScroll: true });
  }, [focusDesks]);
  useEffect(() => {
    if (!isCompactViewport) return;
    const elements = [document.documentElement, document.body, document.querySelector<HTMLElement>(".radar-list-body")].filter((node): node is HTMLElement => !!node);
    const previous = elements.map(node => node.style.overflow);
    elements.forEach(node => { node.style.overflow = "hidden"; });
    return () => elements.forEach((node, i) => { node.style.overflow = previous[i]; });
  }, [isCompactViewport]);
  const tasks = cardOrder(bot.tasks.filter(t => !isClosed(t.displayState)));
  const recent = bot.tasks.filter(t => isClosed(t.displayState)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const workerCount = snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null;
  const chatting = snapshot.chat.has(bot.key);
  const busy = (snapshot.byBot[bot.key]?.length ?? 0) > 0 || chatting || tasks.some(t => ["working", "queued"].includes(t.displayState));
  const workerName = (a: Attempt) => a.model ? `${dispatchModel(a.model)} worker` : "Worker";
  const workerLabel = (a: Attempt, status: string) => `Open worker ${a.title || a.threadId}: ${workerName(a)}${status ? `, ${status}` : ""}`;
  const taskRow = (task: BotTaskRow) => {
    const tone = /^(Cancelled|Stopped)\b/.test(taskStatus(task, now)) ? "ended" : stateTone(task.displayState);
    const name = stageTitle(task.title);
    const attempts = snapshot.byTask[task.id] ?? [];
    const running = attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId);
    const status = cardStatus(task, running, now);
    const reason = stageText(task.needs?.question ?? task.line);
    const ask = task.ask ? askLine(task.ask, now) : "";
    const askOpen = openAsks.has(task.id);
    const outcome = task.outcome && task.outcome !== task.title ? task.outcome : "";
    const extra = reason && !status.includes(reason) ? reason : "";
    return <article key={task.id} className="dispatch-task-group dispatch-card" data-tone={tone}>
      <div className="dispatch-card-head">
        <button type="button" className="dispatch-task" aria-current={task.conversationThreadId === activeThreadId ? "page" : undefined} onClick={() => onNavigate(task.conversationThreadId ?? bot.coordinatorThreadId)}>
          <b dir="auto">{name}</b>
          <span className="dispatch-status-line"><i aria-hidden="true" /><span dir="auto">{status}</span></span>
        </button>
        <button type="button" className="dispatch-task-continue" aria-label={`Continue ${name}`} title="Continue in the bot's chat" onClick={() => {
          window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: name.slice(0, 80) } }));
          onNavigate(bot.coordinatorThreadId);
        }}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />Continue</span></button>
      </div>
      {ask ? <button type="button" className="dispatch-ask-line" dir="auto" aria-expanded={askOpen} onClick={() => setOpenAsks(prev => { const next = new Set(prev); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>{ask}</button> : null}
      {outcome || extra || attempts.length ? <details className="dispatch-details">
        <summary>Details<Icon name="ChevronDown" aria-hidden="true" /></summary>
        {outcome ? <p className="dispatch-full" dir="auto"><span>Goal</span>{youWords(outcome)}</p> : null}
        {extra ? <p className="dispatch-full-status" dir="auto">{extra}</p> : null}
        {attempts.length ? <ul className="dispatch-worker-list">{attempts.map(a => {
          const s = attemptStatus(a, now);
          return <li key={a.threadId}><button type="button" className="dispatch-attempt" onClick={() => onNavigate(a.threadId)} aria-label={`${workerLabel(a, s)} (${a.threadId})`}>
            <span className="dispatch-attempt-head"><i aria-hidden="true" data-running={a.state === "running" || undefined} /><span className="dispatch-worker-model">{workerName(a)}</span>{s ? ` · ${s}` : ""}</span>
            {a.title ? <span className="dispatch-attempt-title" dir="auto">{a.title}</span> : null}
          </button></li>;
        })}</ul> : null}
        {task.ask ? <button type="button" className="dispatch-ask-open" onClick={() => onNavigate(task.ask!.ref.threadId)}>Open your ask in chat</button> : null}
      </details> : null}
    </article>;
  };
  const hue = botStyle(bot.key, bot.name).hue;
  const blockedNow = tasks.some(t => BLOCKED.includes(t.displayState));
  const anchored = anchor && !isCompactViewport;
  return createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}${anchored ? " dispatch-anchored" : ""}`} data-bb-portaled-overlay="" data-bb-plugin={scope} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dispatch-panel" style={{ "--bot-hue": hue, ...(anchored ? anchoredStyle(anchor) : {}) } as CSSProperties} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: work`} onKeyDown={event => {
    if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) return;
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") { const buttons = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => { const closed = node.closest("details:not([open])"); return !closed || node.parentElement === closed && node.tagName === "SUMMARY"; }).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    {isCompactViewport ? <button className="dispatch-grabber" aria-label="Close work panel" onClick={onClose} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) onClose(); drag.current = null; }}><span /></button> : null}
    <header className="dispatch-panel-head"><span className="dispatch-panel-face"><BotTaskFace bot={bot} size={40} state={blockedNow ? "failed" : busy ? "working" : undefined} /></span><div><h2>{shortBotName(bot.name)}</h2><p>{panelSummary(tasks, workerCount, bot.unlinked.length, chatting)}</p></div>{isCompactViewport ? null : <button className="dispatch-close" aria-label="Close" onClick={onClose}><Icon name="X" aria-hidden="true" /></button>}</header>
    <nav className="dispatch-panel-actions" aria-label={`${shortBotName(bot.name)} actions`}>
      {activeThreadId === bot.coordinatorThreadId ? null : <button className="dispatch-chat-pill" onClick={() => onNavigate(bot.coordinatorThreadId)}><Icon name="MessageSquare" aria-hidden="true" />Chat</button>}
      <a className="dispatch-automations" href={automationsHref(bot.key)} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(); }}><Icon name="Clock" aria-hidden="true" />Automations</a>
      <ThreadActionsMenu thread={target} inline={[{ key: "radar-sidebar/all-threads", group: "open", action: { label: "All threads", icon: "List", run: () => { window.dispatchEvent(new Event("radar:show-all-threads")); onShowThreads?.(); onClose(); } } }]} side="bottom" align="end" trigger={props => <button {...props} type="button" className="dispatch-more"><Icon name="MoreHorizontal" aria-hidden="true" />More</button>} />
    </nav>
    <div className="dispatch-panel-body" ref={body}>
    {tasks.filter(t => BLOCKED.includes(t.displayState)).map(t => <div className="dispatch-block-card" key={t.id}><b dir="auto">Blocked · {taskHeadline(t.title)}</b><p>{rowDetail(t, now) || STATE_LABEL[t.displayState]}{t.retryAt ? ` · Retry ${new Date(t.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</p></div>)}
    {tasks.length || bot.unlinked.length ? <><header className="dispatch-section-head"><h3>Tasks</h3><span>{tasks.length + bot.unlinked.length}</span></header><div className="dispatch-open">{tasks.map(taskRow)}{bot.unlinked.map(w => <article className="dispatch-task-group" data-tone="busy" key={w.threadId}><button className="dispatch-task" onClick={() => onNavigate(w.threadId)}><span className="dispatch-status-line"><i aria-hidden="true" />Work without a task</span><b dir="auto">{taskHeadline(w.title || "Worker")}</b></button></article>)}</div></> : <p className="dispatch-idle">{chatting ? IN_CHAT : "Nothing running"}{recent[0]?.completedAt ? ` · last completed ${ago(recent[0].completedAt, now)}` : ""}</p>}
    <DeskThreads ref={desksRef} desks={bot.desks} now={now} onOpen={onNavigate} />
    <ClaimedThreads threads={claims.byBot[bot.key] ?? []} onOpen={onNavigate} />
    <header className="dispatch-section-head"><h3>Recent</h3>{recent.length ? <span>{recent.length}</span> : null}</header>{recent.length ? <div className="dispatch-recent">{recent.map(taskRow)}</div> : <p className="dispatch-idle">No recent tasks</p>}
    </div>
  </div></div>, document.body);
}
