import { DeskThreads } from "./DeskThreads";
import { ClaimedThreads, useThreadClaims } from "./useThreadClaims";
import { ThreadsSection } from "./ThreadsSection";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createPortal, flushSync } from "react-dom";
import { deskTitle, isClosed, needsYou, layoutBot, orderedBots, rowStartedAt, shortModel, STATE_LABEL, type BotDesk, type BotTasksData, type BotTasksBot, type BotTaskRow, type Attempt } from "@/lib/botTasks";
import { BotTaskFace, asOf, clearsLine, clockFormatter, clearsWeekdayFormatter, rowDetail, useDeskPress, type DeskMenu } from "./BotsView";
import { botStyle } from "./bots";
import { automationsHref } from "./automationsLink";
import { askLine, cardOrder, plainNote, stateTone, taskHeadline, youWords } from "./workText";
import { Icon } from "@/components/ui/icon";
import { useDispatchWorkers, type WorkerSnapshot } from "./useDispatchWorkers";
import { BotMenu } from "./BotMenu";
import { NeedsSummary, type NeedItem } from "./NeedsSummary";
import { CollapsedBots } from "./CollapsedBots";
import { useRoving } from "./useRoving";
import { useCoordinatorTarget } from "./BotDeskMenu";
import { StageFace } from "./StageFace";
import { needsCount, rowLook, stageText, stageTitle, type RowLook } from "./stage";
import type { BotTasksState } from "./useBotTasks";

export function dispatchModel(model: string) {
  const family = /(?:^|[-/])(sol|astra|terra|opus|fable|sonnet|haiku)(?:[-/]|$)/i.exec(model)?.[1];
  return family ? family[0].toUpperCase() + family.slice(1).toLowerCase() : shortModel(model);
}
export function elapsed(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
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
  return `next check ${days === 0 ? time : days === 1 ? `tomorrow ${time}` : days < 7 ? `${clearsWeekdayFormatter.format(new Date(at))} ${time}` : `${dateFormatter.format(new Date(at))} ${time}`}`;
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
    return ["Working", first.startedAt != null ? elapsed(first.startedAt, now) : "", running.length > 1 ? `${running.length - 1} more ${running.length === 2 ? "worker" : "workers"}` : ""].filter(Boolean).join(" · ");
  }
  if (isClosed(state)) return taskStatus(task, now).split(" · ").slice(0, 2).join(" · ");
  if (state === "waiting" && task.wakeAt !== undefined) {
    const when = checksLine(task.wakeAt, now);
    const line = when.startsWith("next check ") ? `Next check ${when.slice(11)}` : `Check ${when}`;
    return task.waitFor === "someone else" ? `Waiting on others · ${line[0]!.toLowerCase()}${line.slice(1)}` : line;
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
export interface PanelAnchor { x: number; y: number; rowCenter?: number; align?: "start" | "end" }

function panelAnchor(row: HTMLElement): PanelAnchor {
  const box = row.getBoundingClientRect();
  const side = row.closest(".stage")?.getBoundingClientRect().right ?? box.right;
  return { x: side + 8, y: box.top, rowCenter: box.top + box.height / 2 };
}

const OPENING_TIMEOUT_MS = 8000;

function StageRow({ bot, look, current, opening, unread, needs, onChat, onShowWork }: {
  bot: BotTasksBot; look: RowLook; current: boolean; opening: boolean; unread: boolean; needs: number;
  onChat: () => void; onShowWork: (anchor: PanelAnchor) => void;
}) {
  const press = useDeskPress();
  const name = bot.name;
  const needsLabel = needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "";
  const full = [look.line, look.extra].filter(Boolean).join(" · ");
  const spoken = [needsLabel, unread && look.pose !== "unread" ? "new reply" : "", full].filter(Boolean).join(", ");
  const row = (element: Element) => element.closest<HTMLElement>(".stage-row") ?? (element as HTMLElement);
  const [hover, setHover] = useState(false);
  return <div className="stage-row" data-bot={bot.key} data-tone={look.tone} data-kind={look.kind} data-current={current || undefined}
      data-opening={opening || undefined} data-unread={unread || undefined} data-needs={needs || undefined} data-hover={hover || undefined}
      style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties} {...press}
      onPointerEnter={event => { if (event.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onContextMenu={event => {
        press.onContextMenu(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onShowWork(panelAnchor(event.currentTarget));
      }}
      onKeyDown={event => {
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
          event.preventDefault();
          onShowWork(panelAnchor(event.currentTarget));
        }
      }}>
      <button type="button" className="stage-chat" data-rove={bot.key} aria-current={current ? "page" : undefined} aria-busy={opening || undefined}
        aria-label={`${name}: ${spoken}. Open chat`} aria-keyshortcuts="ArrowRight" title={full} onClick={onChat}>
        <span className="stage-figure">
          <StageFace botKey={bot.key} name={bot.name} pose={look.pose} bare />
        </span>
        <span className="stage-copy">
          <span className="stage-head">
            <b>{name}</b>
            {opening ? <span className="stage-opening" aria-hidden="true" />
              : needs ? <span className="stage-needs-badge" aria-hidden="true">{needs}</span>
              : unread ? <span className="stage-unread-dot" aria-hidden="true" />
              : look.time ? <span className="stage-time">{look.time}</span> : null}
          </span>
          <span className="stage-line"><bdi>{look.line}</bdi></span>
        </span>
      </button>
      <button type="button" className="stage-more" tabIndex={-1} aria-haspopup="dialog"
        aria-label={needs ? `What ${name} needs from you, tasks and settings` : `${name}: tasks, desks and settings`}
        title={needs ? "What it needs, tasks and settings" : "Tasks, desks and settings"}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onShowWork(panelAnchor(row(event.currentTarget))); }}>
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button>
    </div>;
}

function deskAnswered(desk: BotDesk, coordinatorThreadId: string, threads: ReadonlyMap<string, PluginSidebarThread>): boolean {
  if (!needsYou(desk) || !desk.threadId || desk.threadId === coordinatorThreadId) return false;
  const thread = threads.get(desk.threadId);
  if (!thread || thread.updatedAt <= desk.updatedAt) return false;
  return thread.status === "starting" || thread.status === "active" || thread.queuedWork === "waiting";
}

function useAnswered(data: BotTasksData) {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    const byId = new Map(threads.map(thread => [thread.id, thread]));
    const answered: NeedItem[] = [];
    const bots = data.bots.map(bot => {
      const desks = bot.desks.map(desk => {
        if (!deskAnswered(desk, bot.coordinatorThreadId, byId)) return desk;
        answered.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: bot.name, what: `Answered: ${plainNote(deskTitle(desk))}`, kind: "desk", at: desk.updatedAt, threadId: desk.threadId ?? bot.coordinatorThreadId, state: "answered" });
        return { ...desk, status: "working" as const };
      });
      return desks.some((desk, i) => desk !== bot.desks[i]) ? { ...bot, desks } : bot;
    });
    return { data: answered.length ? { ...data, bots } : data, answered };
  }, [data, threads]);
}

export function DispatchBoard({ data: raw, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads, unreadChats }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string) => void; onShowThreads: () => void; deskMenu?: DeskMenu; unreadChats?: ReadonlySet<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { data, answered } = useAnswered(raw);
  const visible = useVisibleSurface(root);
  const snapshot = useDispatchWorkers(data, visible);
  const [sheet, setSheet] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PanelAnchor | undefined>(undefined);
  const [focusDesks, setFocusDesks] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [pointerIn, setPointerIn] = useState(false);
  const [keysIn, setKeysIn] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const claims = useThreadClaims();
  const close = () => { setSheet(null); opener.current?.focus(); };
  useEffect(() => { if (sheet && !data.bots.some(b => b.key === sheet)) setSheet(null); }, [data.bots, sheet]);
  useEffect(() => {
    if (!opening) return;
    if (opening === activeThreadId) { setOpening(null); return; }
    const timer = setTimeout(() => setOpening(null), OPENING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [opening, activeThreadId]);
  const open = (id: string) => { if (id !== activeThreadId) setOpening(id); onOpen(id); };
  const threadNeeds = (claims.ready ? claims.loose : []).filter(thread => thread.hasPendingInteraction || thread.indicator === "waiting-for-input")
    .map(thread => ({ id: `thread:${thread.id}`, botKey: "", botName: thread.displayTitle, what: "Answer needed", kind: "thread" as const, at: thread.latestAttentionAt, threadId: thread.id }));
  const bot = data.bots.find(b => b.key === sheet);
  const showPanel = (key: string, desks: boolean) => (point: PanelAnchor) => {
    opener.current = document.activeElement as HTMLElement;
    setAnchor(point);
    setFocusDesks(desks);
    setSheet(key);
  };
  const currentKey = orderedBots(data).find(b => b.coordinatorThreadId === activeThreadId)?.key ?? null;
  const roving = useRoving(list, { item: ".stage-chat", row: ".stage-row", side: ".stage-more", preferred: currentKey });
  const scope = root.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin") ?? undefined;
  const rows = orderedBots(data).map(b => {
    const unread = !!unreadChats?.has(b.coordinatorThreadId) && activeThreadId !== b.coordinatorThreadId;
    const workers = snapshot.byBot[b.key] ?? [];
    const look = rowLook(b, { running: workers.length, runningTitle: workers[0]?.title, failedChecks: snapshot.failedChecks, chatting: snapshot.chat.has(b.key), unread, now });
    const current = opening ? opening === b.coordinatorThreadId : activeThreadId === b.coordinatorThreadId;
    return { bot: b, unread, look, current, needs: needsCount(b) };
  });
  return <div className="stage" ref={root}
    onPointerEnter={event => { if (event.pointerType === "mouse") setPointerIn(true); }}
    onPointerLeave={() => setPointerIn(false)}
    onFocus={event => setKeysIn((event.target as HTMLElement).matches(":focus-visible"))}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeysIn(false); }}>
    {state.cached || state.status === "error" ? <p className="stage-stale" role="status">Bots core isn't answering. Showing what we knew at {asOf(data.observedAt, now)}.</p> : null}
    <NeedsSummary data={data} extra={threadNeeds} answered={answered} hold={pointerIn || keysIn} now={now} onOpen={open} />
    <div className="stage-bots" role="list" aria-label="Bots" ref={list} onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
    {rows.map(({ bot: b, unread, look, current, needs }) =>
      <div role="listitem" key={b.key}><StageRow bot={b} look={look} current={current} opening={opening === b.coordinatorThreadId} unread={unread} needs={needs}
        onChat={() => open(b.coordinatorThreadId)}
        onShowWork={showPanel(b.key, needs > 0)} /></div>)}
    </div>
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · All threads</button> : null}
    <ThreadsSection activeThreadId={activeThreadId} now={now} onOpen={open} onShowAll={onShowThreads} />
    <CollapsedBots root={root} scope={scope} onOpen={open} bots={rows.map(({ bot: b, unread, look, current, needs }) => ({
      key: b.key, name: b.name, pose: look.pose, status: [look.line, look.extra].filter(Boolean).join(" · "), needs, unread, current, threadId: b.coordinatorThreadId,
    }))} />
    {bot ? <BotWorkPanel key={`${bot.key}:${focusDesks}`} bot={bot} anchor={anchor} focusDesks={focusDesks} snapshot={snapshot} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
      onShowThreads={onShowThreads}
      scope={scope}
      onNavigate={id => { flushSync(() => setSheet(null)); opener.current?.focus(); open(id); }} onClose={close} /> : null}
  </div>;
}

const PANEL_WIDTH = 400;
const EDGE = 12;

const COMPOSER_CLEARANCE = 190;
const MIN_PANEL = 380;

function anchoredStyle(anchor: PanelAnchor): CSSProperties {
  const left = anchor.align === "end" ? anchor.x - PANEL_WIDTH : anchor.x;
  const height = window.innerHeight;
  const cap = Math.min(height * 0.8, 720);
  const clearBottom = height - COMPOSER_CLEARANCE;
  let top = Math.max(EDGE, anchor.y - 6);
  let bottom = clearBottom - top >= MIN_PANEL ? clearBottom : height - EDGE;
  if (bottom - top < MIN_PANEL) top = Math.max(EDGE, bottom - Math.min(cap, MIN_PANEL));
  if (bottom - top > cap) bottom = top + cap;
  const caret = anchor.rowCenter !== undefined ? Math.min(Math.max(anchor.rowCenter - top, 24), bottom - top - 24) : undefined;
  return {
    position: "fixed",
    left: `clamp(${EDGE}px, ${left}px, calc(100vw - ${PANEL_WIDTH + EDGE}px))`,
    top: `${top}px`,
    maxHeight: `${bottom - top}px`,
    ...(caret !== undefined ? { "--caret-y": `${caret}px` } : {}),
  } as CSSProperties;
}

const RECENT_SHOWN = 3;
const SETTLE_MS = 450;

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
  const [allRecent, setAllRecent] = useState(false);
  const openedAt = useRef(performance.now());
  useEffect(() => {
    const section = desksRef.current;
    if (!focusDesks || !section || !body.current) { panel.current?.focus(); return; }
    body.current.scrollTop += section.getBoundingClientRect().top - body.current.getBoundingClientRect().top - 4;
    (section.querySelector<HTMLElement>(".radar-desk-row:not(:disabled), .dispatch-task") ?? panel.current)?.focus({ preventScroll: true });
  }, [focusDesks]);
  useEffect(() => {
    if (!isCompactViewport) return;
    const elements = [document.documentElement, document.body, document.querySelector<HTMLElement>(".radar-list-body")].filter((node): node is HTMLElement => !!node);
    const previous = elements.map(node => node.style.overflow);
    elements.forEach(node => { node.style.overflow = "hidden"; });
    return () => elements.forEach((node, i) => { node.style.overflow = previous[i]; });
  }, [isCompactViewport]);
  const tasks = cardOrder(bot.tasks.filter(t => !isClosed(t.displayState)));
  const asks = tasks.filter(t => t.displayState === "needs");
  const others = tasks.filter(t => t.displayState !== "needs");
  const needDesks = bot.desks.filter(needsYou);
  const otherDesks = bot.desks.filter(desk => !needsYou(desk));
  const recent = bot.tasks.filter(t => isClosed(t.displayState)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const workerCount = snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null;
  const chatting = snapshot.chat.has(bot.key);
  const busy = (snapshot.byBot[bot.key]?.length ?? 0) > 0 || chatting || tasks.some(t => ["working", "queued"].includes(t.displayState));
  const workerLabel = (a: Attempt, status: string) => `Open worker${a.title ? ` ${a.title}` : ""}${status ? `, ${status}` : ""}`;
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
          return <li key={a.threadId}><button type="button" className="dispatch-attempt" onClick={() => onNavigate(a.threadId)} aria-label={workerLabel(a, s)} title={a.model ? `Model: ${dispatchModel(a.model)}` : undefined}>
            <span className="dispatch-attempt-head"><i aria-hidden="true" data-running={a.state === "running" || undefined} /><span className="dispatch-worker-model">Worker</span>{s ? ` · ${s}` : ""}</span>
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
  return createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}${anchored ? " dispatch-anchored" : ""}`} data-bb-portaled-overlay="" data-bb-plugin={scope} onClickCapture={event => { if (isCompactViewport && performance.now() - openedAt.current < SETTLE_MS) { event.preventDefault(); event.stopPropagation(); } }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dispatch-panel" data-caret={anchored && anchor?.rowCenter !== undefined || undefined} style={{ "--bot-hue": hue, ...(anchored ? anchoredStyle(anchor) : {}) } as CSSProperties} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: work`} onKeyDown={event => {
    if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) return;
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") { const buttons = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => { const closed = node.closest("details:not([open])"); return !closed || node.parentElement === closed && node.tagName === "SUMMARY"; }).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    {isCompactViewport ? <button className="dispatch-grabber" aria-label="Close work panel" onClick={onClose} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) onClose(); drag.current = null; }}><span /></button> : null}
    <header className="dispatch-panel-head"><span className="dispatch-panel-face"><BotTaskFace bot={bot} size={40} state={blockedNow ? "failed" : busy ? "working" : undefined} /></span><div><h2>{bot.name}</h2><p>{panelSummary(tasks, workerCount, bot.unlinked.length, chatting)}</p></div><button className="dispatch-close" aria-label={`Close ${bot.name}`} onClick={onClose}><Icon name="X" aria-hidden="true" /></button></header>
    <nav className="dispatch-panel-actions" aria-label={`${bot.name} actions`}>
      {activeThreadId === bot.coordinatorThreadId ? null : <button className="dispatch-chat-pill" onClick={() => onNavigate(bot.coordinatorThreadId)}><Icon name="MessageSquare" aria-hidden="true" />Chat</button>}
      <a className="dispatch-automations" href={automationsHref(bot.key)} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(); }}><Icon name="Clock" aria-hidden="true" />Automations</a>
      <BotMenu thread={target} botName={bot.name} onShowThreads={() => { window.dispatchEvent(new Event("radar:show-all-threads")); onShowThreads?.(); }} onClose={onClose} />
    </nav>
    <div className="dispatch-panel-body" ref={body}>
    {asks.length || needDesks.length ? <section className="dispatch-needs" ref={desksRef} aria-label="Needs you">
      <header className="dispatch-section-head dispatch-needs-head"><h3>Needs you</h3><span>{asks.length + needDesks.length}</span></header>
      {asks.length ? <div className="dispatch-open">{asks.map(taskRow)}</div> : null}
      {needDesks.length ? <DeskThreads desks={needDesks} now={now} onOpen={onNavigate} bare /> : null}
    </section> : null}
    {tasks.filter(t => BLOCKED.includes(t.displayState)).map(t => <div className="dispatch-block-card" key={t.id}><b dir="auto">Stuck · {taskHeadline(t.title)}</b><p>{rowDetail(t, now) || STATE_LABEL[t.displayState]}{t.retryAt ? ` · Retry ${new Date(t.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</p></div>)}
    {others.length || bot.unlinked.length ? <><header className="dispatch-section-head"><h3>Tasks</h3><span>{others.length + bot.unlinked.length}</span></header><div className="dispatch-open">{others.map(taskRow)}{bot.unlinked.map(w => <article className="dispatch-task-group" data-tone="busy" key={w.threadId}><button className="dispatch-task" onClick={() => onNavigate(w.threadId)}><span className="dispatch-status-line"><i aria-hidden="true" />Work without a task</span><b dir="auto">{taskHeadline(w.title || "Worker")}</b></button></article>)}</div></> : asks.length ? null : <p className="dispatch-idle">{chatting ? IN_CHAT : "Nothing running"}{recent[0]?.completedAt ? ` · last finished ${ago(recent[0].completedAt, now)}` : ""}</p>}
    <DeskThreads desks={otherDesks} now={now} onOpen={onNavigate} />
    <ClaimedThreads threads={claims.byBot[bot.key] ?? []} onOpen={onNavigate} />
    <header className="dispatch-section-head"><h3>Recent</h3>{recent.length ? <span>{recent.length}</span> : null}</header>{recent.length ? <div className="dispatch-recent">{(allRecent ? recent : recent.slice(0, RECENT_SHOWN)).map(taskRow)}</div> : <p className="dispatch-idle">No recent tasks</p>}
    {recent.length > RECENT_SHOWN ? <button type="button" className="dispatch-recent-more" aria-expanded={allRecent} onClick={() => setAllRecent(value => !value)}>{allRecent ? "Show fewer" : `Show all ${recent.length}`}</button> : null}
    </div>
  </div></div>, document.body);
}
