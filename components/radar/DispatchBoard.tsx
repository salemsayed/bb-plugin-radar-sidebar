import { DeskThreads } from "./DeskThreads";
import { ClaimedThreads, useThreadClaims } from "./useThreadClaims";
import { ThreadsSection, threadsSummary } from "./ThreadsSection";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createPortal, flushSync } from "react-dom";
import { answerOptions, deskTitle, isClosed, needsYou, layoutBot, orderedBots, rowStartedAt, shortModel, STATE_LABEL, type BotDesk, type BotTasksData, type BotTasksBot, type BotTaskRow, type Attempt } from "@/lib/botTasks";
import { BotTaskFace, asOf, clearsLine, clockFormatter, clearsWeekdayFormatter, rowDetail, useDeskPress, type DeskMenu } from "./BotsView";
import { botStyle } from "./bots";
import { automationsHref } from "./automationsLink";
import { askLine, askParts, capCut, readableCut, capitalFirst, cardOrder, cutAtWord, plainNote, plainQueue, plainWorkerTitle, readerWords, sameJob, stateTone, taskHeadline, waitingOn, ASK_PREVIEW, type OriginalOf } from "./workText";
import { Isolated } from "./Isolated";
import { Icon } from "@/components/ui/icon";
import { useDispatchWorkers, withNamedWorkers, type WorkerSnapshot } from "./useDispatchWorkers";
import { BotMenu } from "./BotMenu";
import { NeedsSummary, askPlace, botMenuLabel, fitWhat, needItems, notNowLabel, type NeedItem } from "./NeedsSummary";
import { CollapsedBots } from "./CollapsedBots";
import { useRoving } from "./useRoving";
import { useCoordinatorTarget } from "./BotDeskMenu";
import { StageFace } from "./StageFace";
import { useRailHomeCurrent } from "./useRailHomeCurrent";
import { answeredHere, deskNeedLine, isOldAsk, needAsk, needsCount, rowLook, scheduledWait, stageText, stageTitle, withOldAsks, type RowLook } from "./stage";
import { isQuestionRow, needsTopic, questionInPanel, questionTopic, withQuestions } from "./questions";
import { FitLines, cutForms } from "./FitLines";
import { askForms } from "./choiceFit";
import { requestFill } from "@/lib/composerFill";
import { armAskStrip } from "@/lib/askStrip";
import { askedAgo } from "./NeedsSummary";
import { refreshBotTasks, type BotTasksState } from "./useBotTasks";
import { applyNotNow, bringBack, notNow, taskNotNowKey, useNotNow } from "@/lib/notNow";
import { NotNowToastView } from "./NotNowToast";
import { useNeedsYou } from "@/lib/needsClient";

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
  const label = /^(Cancelled|Stopped)\b/.test(parts[0] ?? "") ? parts.shift()!.replace(/^(Cancelled|Stopped) (?:from the task header|by hand)\.?$/i, "$1") : /^Closed by (?:Salem|you)\b/i.test(parts[0] ?? "") ? (parts.shift(), "Closed by you") : STATE_LABEL[task.displayState];
  return [label, task.completedAt !== undefined ? dayAndTime(task.completedAt, now) : "", ...parts].filter(Boolean).join(" · ");
}
const CHECKING = /not checked|checks needed|check failed|hasn't (?:checked|closed|finished)|evidence needs review|owner review/i;
const CRITERIA = /^checking (\d+) of (\d+) criteria/i;
const NO_CHECK = "no check scheduled";
const IDLE_WAIT = "Waits for its worker to finish";
export interface IdleWait { title: string; running: boolean; idleFor?: string }

export function cardStatus(task: BotTaskRow, running: Attempt[], now: number, waitsOn?: IdleWait | null): string {
  const state = task.displayState;
  if (task.later) return answeredHere(task.later) ? "You answered · bot to follow up" : task.later.reason === "answered" ? "Moved to Later" : "Back when the bot asks again";
  if (state === "needs" && isQuestionRow(task)) return task.needs?.question ?? task.title;
  if (state === "needs") {
    const ask = needAsk((task.needs?.question ?? task.line).replace(/^(?:needs you|waiting for you)\s*[:·-]\s*/i, ""), stageTitle(task.title, task.outcome));
    return ask || "Waiting on you";
  }
  if (state === "working" || running.length && !isClosed(state)) {
    const first = [...running].sort((a, b) => (a.startedAt ?? now) - (b.startedAt ?? now))[0];
    if (!first) return "Working";
    const span = first.startedAt != null ? ` for ${elapsed(first.startedAt, now)}` : "";
    return running.length > 1 ? `${running.length} workers · working${span}` : `Working${span}`;
  }
  if (isClosed(state)) {
    const [label = "", when = ""] = taskStatus(task, now).split(" · ");
    const unconfirmed = state === "done" && /\bRecorded done\b.*(?:owner review|evidence needs review)/i.test(task.line);
    return [unconfirmed ? "Done, not confirmed yet" : label, when].filter(Boolean).join(" · ");
  }
  if (state === "waiting" && task.wakeAt !== undefined) {
    const when = checksLine(task.wakeAt, now);
    const line = when.startsWith("next check ") ? `Next check ${when.slice(11)}` : `Check ${when}`;
    if (task.waitFor !== "someone else") return line;
    const who = waitingOn(task.line, task.outcome);
    return `${who ? `Waiting on ${who}` : "Waiting on someone else"} · ${line[0]!.toLowerCase()}${line.slice(1)}`;
  }
  const line = task.line;
  if (/^Its machine is off/.test(line)) return "Machine off · resumes when it is back";
  if (/^Queued/.test(line)) {
    const why = plainQueue(line).split(" · ")[0]!;
    const label = /^(?:Starts|Not started)/.test(why) ? why : "Queued";
    return task.retryAt && task.retryAt > now ? `${label} · next try ${clockFormatter.format(new Date(task.retryAt))}` : label;
  }
  if (/^Retrying/.test(line)) return "Retrying after an error";
  if (/^Wake was due/.test(line) || state === "overdue") return "Check overdue";
  if (/^Filed\. Not started/.test(line) || state === "ready") return "Not started";
  if (/^With the bot/.test(line)) return "With the bot";
  const criteria = CRITERIA.exec(line);
  if (criteria) return `Checking its ${criteria[2]} ${criteria[2] === "1" ? "goal" : "goals"}`;
  if (CHECKING.test(line) || state === "checking") return "Result waits for the bot's check";
  const scheduled = scheduledWait(line);
  if (scheduled === IDLE_WAIT && !running.length && waitsOn) return waitsOn.running ? `Waits for the ${waitsOn.title} worker to finish` : `Its worker is idle${waitsOn.idleFor ? ` for ${waitsOn.idleFor}` : ""} · ${NO_CHECK}`;
  if (scheduled) return scheduled;
  if (task.waitFor === "someone else") { const who = waitingOn(task.line, task.outcome); return `${who ? `Waiting on ${who}` : "Waiting on someone else"} · ${NO_CHECK}`; }
  if (state === "offline") return "Machine off";
  if (state === "queued") return "Queued";
  return `Waiting on ${task.waitFor === "you" ? "you" : "the bot"} · ${NO_CHECK}`;
}
export function attemptStatus(attempt: Attempt, now: number): string {
  if (attempt.state === "running") return attempt.startedAt != null ? `working for ${elapsed(attempt.startedAt, now)}` : "working";
  if (attempt.state === "unknown") return "";
  return attempt.endedAt != null && elapsed(attempt.endedAt, now) !== "now" ? `${attempt.state} ${elapsed(attempt.endedAt, now)}` : attempt.state;
}
export function panelSummary(counts: { asks: number; tasks: number; later: number; workers: number | null; old?: number }, chatting = false): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [counts.asks ? `${n(counts.asks, "question", "questions")} for you` : "", counts.old ? n(counts.old, "old ask", "old asks") : "", counts.tasks ? n(counts.tasks, "task", "tasks") : "", counts.later ? `${counts.later} later` : "", counts.workers ? `${n(counts.workers, "worker", "workers")} running` : ""].filter(Boolean).join(" · ") || (chatting ? IN_CHAT : "Nothing running");
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
const STALE_AFTER_MS = 8000;

function StageRow({ bot, look, current, here, marked, opening, unread, needs, panelOpen, onChat, onShowWork }: {
  bot: BotTasksBot; look: RowLook; current: boolean; here: boolean; marked: boolean; opening: boolean; unread: boolean; needs: number; panelOpen: boolean;
  onChat: () => void; onShowWork: (anchor: PanelAnchor) => void;
}) {
  const press = useDeskPress();
  const name = bot.name;
  const needsLabel = needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "";
  const full = look.ask ?? [look.whole ?? look.line, look.extra].filter(Boolean).join(" · ");
  const when = look.time && look.time !== "now" ? `last reply ${look.time} ago` : "";
  const spoken = [needsLabel, unread ? "new reply" : "", full, when, here ? "you are in one of its chats" : ""].filter(Boolean).join(", ");
  const row = (element: Element) => element.closest<HTMLElement>(".stage-row") ?? (element as HTMLElement);
  const [hover, setHover] = useState(false);
  return <div className="stage-row" data-bot={bot.key} data-tone={look.tone} data-kind={look.kind} data-current={current || undefined} data-here={here && !current || undefined}
      data-opening={opening || undefined} data-unread={unread || undefined} data-needs={needs || undefined} data-hover={hover || undefined} data-panel={panelOpen || undefined}
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
      <button type="button" className="stage-chat" data-rove={bot.key} aria-current={marked && (current || here) ? "page" : undefined} aria-busy={opening || undefined}
        aria-label={`${name}: ${spoken.replace(/[.\s]+$/, "")}. Open chat. Right arrow for tasks and settings`} aria-keyshortcuts="ArrowRight" title={full} onClick={onChat}>
        <span className="stage-figure">
          <StageFace botKey={bot.key} name={bot.name} pose={look.pose} bare />
        </span>
        <span className="stage-copy">
          <span className="stage-head">
            <b>{name}</b>
            {opening ? <span className="stage-opening" aria-hidden="true" />
              : <span className="stage-aside" aria-hidden="true">
                {look.time ? <span className="stage-time" title={look.timeTitle}>{look.time}</span> : null}
                {unread ? <span className="stage-unread-dot" title="New reply" /> : null}
              </span>}
          </span>
          <FitLine look={look} />
        </span>
      </button>
      <button type="button" className="stage-more" tabIndex={-1} aria-haspopup="dialog" aria-expanded={panelOpen}
        aria-label={botMenuLabel(name, needs > 0)}
        title={botMenuLabel(name, needs > 0)}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onShowWork(panelAnchor(row(event.currentTarget))); }}>
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button>
    </div>;
}

let lineCanvas: HTMLCanvasElement | null = null;
const MARK_PX = 11;

function lineWidth(text: string, font: string): number {
  lineCanvas ??= document.createElement("canvas");
  const context = lineCanvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function FitLine({ look }: { look: RowLook }) {
  const ref = useRef<HTMLSpanElement>(null);
  const options = useMemo(() => [look.line, ...(look.alts ?? [])], [look.line, look.alts]);
  const [pick, setPick] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || options.length < 2) { setPick(0); return; }
    const measure = () => {
      const style = getComputedStyle(box);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = box.clientWidth - (look.tone === "ask" || look.tone === "busy" || look.tone === "blocked" ? MARK_PX : 0);
      const whole = options.findIndex(option => !/\u2026$/.test(option) && lineWidth(option, font) <= room);
      const at = whole >= 0 ? whole : options.findIndex(option => lineWidth(option, font) <= room);
      const shortest = options.map((option, i) => ({ option, i })).filter(({ option }) => !/\u2026$/.test(option)).sort((a, b) => a.option.length - b.option.length)[0];
      setPick(at >= 0 ? at : shortest?.i ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    document.fonts?.addEventListener("loadingdone", measure);
    return () => { live = false; observer.disconnect(); document.fonts?.removeEventListener("loadingdone", measure); };
  }, [options, look.tone]);
  const said = look.whole ?? look.line;
  return <span className="stage-line" ref={ref} title={(options[pick] ?? look.line) !== said ? said : undefined}><bdi>{options[pick] ?? look.line}</bdi></span>;
}

function botOfThread(threadId: string, data: BotTasksData, threads: ReadonlyMap<string, PluginSidebarThread>): string | undefined {
  const byCoordinator = new Map(data.bots.map(b => [b.coordinatorThreadId, b.name]));
  let id: string | null | undefined = threadId;
  for (let hop = 0; id && hop < 4; hop++) {
    const name = byCoordinator.get(id);
    if (name) return name;
    const thread = threads.get(id);
    id = thread?.lifecycleOwnerThreadId ?? thread?.parentThreadId;
  }
  return undefined;
}

function ownerOf(threadId: string, data: BotTasksData, snapshot: WorkerSnapshot, threads: ReadonlyMap<string, PluginSidebarThread>): string | null {
  const direct = (id: string) => data.bots.find(b => b.coordinatorThreadId === id || b.desks.some(desk => desk.threadId === id)
    || b.tasks.some(task => task.conversationThreadId === id || task.needs?.threadId === id || (snapshot.byTask[task.id] ?? []).some(a => a.threadId === id))
    || (snapshot.byBot[b.key] ?? []).some(a => a.threadId === id))?.key;
  let id: string | null | undefined = threadId;
  for (let hop = 0; id && hop < 4; hop++) {
    const key = direct(id);
    if (key) return key;
    const thread = threads.get(id);
    id = thread?.lifecycleOwnerThreadId ?? thread?.parentThreadId;
  }
  return null;
}

const CLOSED_ONLY = /^(?:Done|Closed by (?:you|Salem)|Cancelled|Stopped)(?: (?:from the task header|by hand|today|yesterday|on)?\s*(?:\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2})?)?\.?$/i;
const CLOSED_SAYS: [RegExp, string][] = [
  [/^Recorded done · owner review needed$/i, "Result not confirmed yet"],
  [/^Recorded done · evidence needs review$/i, "Proof not checked yet"],
];

function closedNote(task: BotTaskRow, reason: string): string {
  if (!isClosed(task.displayState)) return reason;
  if (CLOSED_ONLY.test(reason.trim())) return "";
  for (const [pattern] of CLOSED_SAYS) if (pattern.test(reason.trim())) return "";
  return reason;
}

export function yourAskSplit(text: string): { asked: string; status: string } | null {
  const said = /^Your ask:\s+(.+)$/.exec(text);
  if (!said) return null;
  const body = said[1]!;
  const end = /[.!?](?=\s+\S)/.exec(body);
  const asked = capitalFirst((end ? body.slice(0, end.index + 1) : body).trim());
  const status = capitalFirst((end ? body.slice(end.index + 1) : "").trim().replace(/^(?:an? )?worker (?:is )?(\w+ing)\b/i, "A worker is $1"));
  return { asked, status };
}

function idleWait(task: BotTaskRow, bot: BotTasksBot, snapshot: WorkerSnapshot, now: number): IdleWait | null {
  if (!/\bwakes on thread-idle\b/i.test(task.line)) return null;
  const named = /\bthr_[a-z0-9]+/.exec(task.line)?.[0];
  if (named) {
    for (const other of bot.tasks) {
      const attempt = (snapshot.byTask[other.id] ?? []).find(a => a.threadId === named);
      if (!attempt) continue;
      if (attempt.state === "running") return { title: other.id === task.id ? "" : stageTitle(other.title, other.outcome), running: other.id !== task.id };
      return { title: "", running: false, idleFor: attempt.endedAt != null ? elapsed(attempt.endedAt, now) : undefined };
    }
  }
  const own = (snapshot.byTask[task.id] ?? []).filter(a => a.state !== "running").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  return own ? { title: "", running: false, idleFor: own.endedAt != null ? elapsed(own.endedAt, now) : undefined } : null;
}

function detailReason(text: string): string {
  return capitalFirst(plainQueue(text).replace(/^Waiting for (?:someone else|the bot|you|a worker):\s*/i, "").replace(/^You:\s+/i, "Your ask: ").replace(/(?:\s*·\s*(?:wakes?\b[^·]*|next check [^·]+|no wake set|untou\w*[^·]*|retry\b[^·]*))+\s*$/i, "").replace(/\s*·\s*$/, "").trim());
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
    return { data: answered.length ? { ...data, bots } : data, answered, byId };
  }, [data, threads]);
}

export function DispatchBoard({ data: raw, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads, unreadChats }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string, messageSeq?: number) => void; onShowThreads: () => void; deskMenu?: DeskMenu; unreadChats?: ReadonlySet<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const bell = useNeedsYou(true);
  const bothFresh = state.status !== "loading" && bell.status !== "loading";
  const held = useRef<{ raw: BotTasksData; items: typeof bell.items } | null | undefined>(undefined);
  if (held.current === undefined) held.current = state.cached ? { raw, items: bell.items } : null;
  if (bothFresh) held.current = null;
  const shownRaw = held.current?.raw ?? raw;
  const { data: seen, answered, byId } = useAnswered(shownRaw);
  const later = useNotNow(shownRaw.notNow);
  const questioned = withQuestions(seen, held.current ? held.current.items : bell.items, later.laterAt).data;
  const data = withOldAsks(applyNotNow(questioned, later), threadId => byId.get(threadId)?.latestAttentionAt ?? undefined);
  const visible = useVisibleSurface(root);
  const linkedSnapshot = useDispatchWorkers(data, visible);
  const snapshot = useMemo(() => withNamedWorkers(linkedSnapshot, data.bots, [...byId.values()].map(thread => ({ id: thread.id, title: thread.title, status: thread.status, parentThreadId: thread.parentThreadId, lifecycleOwnerThreadId: thread.lifecycleOwnerThreadId, createdAt: (thread as { createdAt?: number }).createdAt }))), [linkedSnapshot, data.bots, byId]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PanelAnchor | undefined>(undefined);
  const [focusDesks, setFocusDesks] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [pointerIn, setPointerIn] = useState(false);
  const [keysIn, setKeysIn] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const inside = (target: EventTarget | null) => target instanceof Node && !!root.current?.contains(target);
  useEffect(() => {
    if (state.status !== "loading") { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), Math.max(0, STALE_AFTER_MS - (Date.now() - mountedAt)));
    return () => clearTimeout(timer);
  }, [state.status, mountedAt]);
  useEffect(() => {
    if (!pointerIn) return;
    const check = (event: PointerEvent) => { if (!inside(event.target)) setPointerIn(false); };
    const away = () => setPointerIn(false);
    document.addEventListener("pointermove", check, true);
    document.addEventListener("pointerdown", check, true);
    document.documentElement.addEventListener("pointerleave", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointermove", check, true);
      document.removeEventListener("pointerdown", check, true);
      document.documentElement.removeEventListener("pointerleave", away);
      window.removeEventListener("blur", away);
    };
  }, [pointerIn]);
  useEffect(() => { if (!later.toast) setPointerIn(value => value && !!root.current?.matches(":hover")); }, [later.toast]);
  const opener = useRef<HTMLElement | null>(null);
  const claims = useThreadClaims();
  const originalOf = useMemo<OriginalOf>(() => {
    const yours = data.bots.flatMap(b => b.tasks).flatMap(t => t.ask && /^You asked/.test(t.ask.label) ? [{ threadId: t.ask.ref.threadId, seq: t.ask.ref.seq, text: t.ask.full ?? t.ask.excerpt }] : []);
    return (threadId, seq, words) => {
      const same = yours.find(o => o.threadId === threadId && o.seq === seq);
      if (same) return same.text;
      if (words.length < 16) return undefined;
      for (const o of yours) { const at = o.text.indexOf(words); if (at >= 0) return o.text.slice(at); }
      return undefined;
    };
  }, [data.bots]);
  useRailHomeCurrent(!!activeThreadId);
  const close = () => { setSheet(null); opener.current?.focus(); };
  useEffect(() => { if (sheet && !data.bots.some(b => b.key === sheet)) setSheet(null); }, [data.bots, sheet]);
  useEffect(() => {
    if (!opening) return;
    if (opening === activeThreadId) { setOpening(null); return; }
    const timer = setTimeout(() => setOpening(null), OPENING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [opening, activeThreadId]);
  const open = (id: string, messageSeq?: number) => { if (id !== activeThreadId) setOpening(id); onOpen(id, messageSeq); };
  const threadNeeds = (claims.ready ? claims.loose : []).filter(thread => (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") && later.laterAt(`thread:${thread.id}`, thread.latestAttentionAt ?? 0) === null)
    .map(thread => ({ id: `thread:${thread.id}`, botKey: "", botName: thread.displayTitle, what: "Answer needed", kind: "thread" as const, at: thread.latestAttentionAt, threadId: thread.id, thread, notNowKey: `thread:${thread.id}` }));
  const bot = data.bots.find(b => b.key === sheet);
  const showPanel = (key: string, desks: boolean) => (point: PanelAnchor) => {
    opener.current = document.activeElement as HTMLElement;
    setKeyboardOpen(!!opener.current?.matches?.(":focus-visible"));
    setAnchor(point);
    setFocusDesks(desks);
    setSheet(key);
  };
  const currentKey = orderedBots(data).find(b => b.coordinatorThreadId === activeThreadId)?.key ?? null;
  const hereKey = currentKey ?? (activeThreadId ? ownerOf(activeThreadId, data, snapshot, byId) : null);
  const needMarked = !!activeThreadId && (data.bots.some(b => b.tasks.some(t => t.displayState === "needs" && askPlace(t, b.coordinatorThreadId).threadId === activeThreadId) || b.desks.some(d => needsYou(d) && (d.threadId ?? b.coordinatorThreadId) === activeThreadId)) || threadNeeds.some(item => item.threadId === activeThreadId) || answered.some(item => item.threadId === activeThreadId));
  const unreachable = state.status === "error" || state.cached && state.status === "loading" && slow;
  const retry = () => { setRetrying(true); void refreshBotTasks().finally(() => setRetrying(false)); };
  const staleNote = { asOf: asOf(data.observedAt, now), retrying, onRetry: retry };
  const staleInBox = unreachable && (needItems(data).length > 0 || threadNeeds.length > 0 || answered.length > 0);
  const roving = useRoving(list, { item: ".stage-chat", row: ".stage-row", side: ".stage-more", preferred: hereKey });
  const scope = root.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin") ?? undefined;
  const loose = threadsSummary(claims.ready ? claims.loose : []);
  const collapsedThreads = { text: loose.text, tone: loose.needs ? "needs" as const : loose.failed ? "failed" as const : loose.loud ? "unread" as const : null, count: claims.ready ? claims.loose.length : null };
  const askChecking = bell.status === "loading" && bell.items === null && !unreachable;
  const rows = orderedBots(data).map(b => {
    const unread = !!unreadChats?.has(b.coordinatorThreadId) && activeThreadId !== b.coordinatorThreadId;
    const workers = snapshot.byBot[b.key] ?? [];
    const base = rowLook(b, { running: workers.length, runningTitle: workers[0]?.title, failedChecks: snapshot.failedChecks, chatting: snapshot.chat.has(b.key), unread, now, lastReply: byId.get(b.coordinatorThreadId)?.latestAttentionAt });
    const look = askChecking && base.pose !== "asking" ? { ...base, line: "Checking…", alts: undefined, whole: undefined, ask: undefined, extra: "", tone: "quiet" as const, kind: "calm" as const, badge: null, quiet: true } : base;
    const current = opening ? opening === b.coordinatorThreadId : activeThreadId === b.coordinatorThreadId;
    return { bot: b, unread, look, current, here: !opening && hereKey === b.key, needs: needsCount(b) };
  });
  return <div className="stage" ref={root}
    onPointerEnter={event => { if (event.pointerType === "mouse" && inside(event.target)) setPointerIn(true); }}
    onPointerLeave={() => setPointerIn(false)}
    onFocus={event => { if (inside(event.target)) setKeysIn((event.target as HTMLElement).matches(":focus-visible")); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeysIn(false); }}>
    <div className="stage-needs-slot">
      <NeedsSummary data={data} extra={threadNeeds} answered={answered} hold={pointerIn || keysIn} now={now} activeThreadId={activeThreadId} onOpen={(id, seq, item) => { if (item?.kind === "ask" && !item.state) armAskStrip({ key: item.id, threadId: item.threadId, messageSeq: item.messageSeq, question: item.what, title: item.title, options: item.options ?? [], botName: item.botName, askedAt: item.since === "asked" ? item.at : undefined }); open(id, seq); }}
        checking={!bothFresh && !unreachable} cold={!held.current}
        stale={unreachable ? staleNote : null}
        onMenu={(item, at) => { if (item.botKey) showPanel(item.botKey, true)(panelAnchor(at)); }}
        onNotNow={item => { if (item.notNowKey) void notNow(item.notNowKey, notNowLabel(item)); }}
        parked={key => later.pending(key) !== null || later.laterAt(key) !== null} />
      {unreachable && !staleInBox ? <div className="stage-stale" role="alert">
        <Icon name="AlertCircle" aria-hidden="true" />
        <p><b>Can't reach the bots right now</b><span>Showing what we had at {asOf(data.observedAt, now)}</span></p>
        <button type="button" disabled={retrying} onClick={retry}>{retrying ? "Trying…" : "Retry"}</button>
      </div> : null}
    </div>
    <div className="stage-bots-head" aria-hidden="true"><span>Bots</span><span>Last reply</span></div>
    <div className="stage-bots" role="list" aria-label="Bots" ref={list} onFocus={roving.onFocus} onKeyDown={event => {
      const first = list.current?.querySelector<HTMLElement>(".stage-chat");
      const above = Array.from(root.current?.querySelectorAll<HTMLElement>(".stage-needs-item") ?? []).at(-1);
      if (event.key === "ArrowUp" && above && event.target === first) { event.preventDefault(); above.focus(); return; }
      roving.onKeyDown(event);
    }}>
    {rows.map(({ bot: b, unread, look, current, here, needs }) =>
      <div role="listitem" key={b.key}><StageRow bot={b} look={look} current={current} here={here} marked={!needMarked} opening={opening === b.coordinatorThreadId} unread={unread} needs={needs} panelOpen={sheet === b.key}
        onChat={() => open(b.coordinatorThreadId)}
        onShowWork={showPanel(b.key, needs > 0)} /></div>)}
    </div>
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · All threads</button> : null}
    <ThreadsSection activeThreadId={activeThreadId} now={now} onOpen={open} onShowAll={onShowThreads} />
    <CollapsedBots root={root} scope={scope} onOpen={open} threads={collapsedThreads} bots={rows.map(({ bot: b, unread, look, current, here, needs }) => ({
      key: b.key, name: b.name, pose: look.pose, status: look.ask ?? [look.whole ?? look.line, look.extra].filter(Boolean).join(" · "), needs, unread, working: look.tone === "busy", current, here, threadId: b.coordinatorThreadId,
    }))} />
    {bot ? <BotWorkPanel key={`${bot.key}:${focusDesks}`} bot={bot} originalOf={originalOf} askerOf={threadId => botOfThread(threadId, data, byId) ?? data.bots.find(b => b.key === ownerOf(threadId, data, snapshot, byId))?.name} anchor={anchor} focusDesks={focusDesks} keyboard={keyboardOpen} snapshot={snapshot} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
      onShowThreads={onShowThreads}
      scope={scope}
      onNavigate={(id, messageSeq) => { flushSync(() => setSheet(null)); opener.current?.focus(); open(id, messageSeq); }} onClose={close} /> : null}
    <NotNowToastView toast={later.toast} scope={scope} layout={sheet ?? ""} />
  </div>;
}

const PANEL_WIDTH = 400;
const EDGE = 12;

const PREFERRED_PANEL = 760;

function anchoredStyle(anchor: PanelAnchor): CSSProperties {
  const left = anchor.align === "end" ? anchor.x - PANEL_WIDTH : anchor.x;
  const height = window.innerHeight;
  const bottom = height - EDGE;
  const tallest = bottom - EDGE;
  const wanted = Math.min(PREFERRED_PANEL, tallest);
  const top = Math.max(EDGE, Math.min(anchor.y - 6, bottom - wanted));
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
const CHANNEL = /^(?:chat|whatsapp|dm|desk|email|ticket chat)$/i;

function DeskNeedCard({ desk, now, current, onOpen, botName }: { desk: BotDesk; now: number; current: boolean; onOpen: (threadId: string) => void; botName: string }) {
  const parts = plainNote(deskTitle(desk)).split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  const channel = parts.length > 1 && CHANNEL.test(parts[0]!) ? parts.shift()! : desk.label.trim();
  const person = parts.length > 1 ? parts[0]! : "";
  const subject = capitalFirst(parts.length > 1 ? parts.slice(1).join(" · ") : parts[0] ?? channel);
  const where = /^whatsapp$/i.test(channel) ? "WhatsApp chat" : capitalFirst(channel || "Desk");
  const meta = `${where}${person ? ` with ${person}` : ""} · ${askedAgo(elapsed(desk.updatedAt, now))}`;
  const parked = desk.later !== undefined;
  const ask = parked ? "Back when the desk changes" : deskNeedLine(desk);
  const open = () => { if (desk.threadId) onOpen(desk.threadId); };
  const key = `desk:${desk.id}`;
  return <article className="dispatch-task-group dispatch-card" data-tone={parked ? "quiet" : "needs"}>
    <div className="dispatch-card-head">
      <button type="button" className="dispatch-task" disabled={!desk.threadId} aria-current={current ? "page" : undefined} aria-label={`${subject}. ${ask}`} onClick={open}>
        <b dir="auto"><Isolated text={subject} /></b>
      </button>
      {parked ? <button type="button" className="dispatch-later-action radar-not-now" aria-label={`Bring back ${subject}`} title="Put it back in Needs you" onClick={() => void bringBack(key, subject)}><span className="radar-not-now-pill">Bring back</span></button>
        : <button type="button" className="dispatch-later-action radar-not-now" aria-label={`Not now: ${notNowLabel({ botName, title: subject, what: ask })}`} title="Not now: move to Later until the desk changes" onClick={() => void notNow(key, notNowLabel({ botName, title: subject, what: ask }))}><span className="radar-not-now-pill">Not now</span></button>}
      {desk.threadId ? <button type="button" className="dispatch-task-continue" aria-label={`Continue ${subject}`} title="Continue in this chat" onClick={open}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />Continue</span></button> : null}
    </div>
    <div className="dispatch-card-ask" aria-hidden="true" onClick={open}><span className="dispatch-status-line"><i aria-hidden="true" /><span dir="auto"><Isolated text={ask} /></span></span></div>
    <p className="dispatch-ask-line" dir="auto"><span className="dispatch-ask-text"><Isolated text={meta} /></span></p>
  </article>;
}
const WORKERS_SHOWN = 5;

function workerNames(attempts: readonly Attempt[]): Map<string, string> {
  const base = new Map(attempts.map(a => [a.threadId, a.title ? plainWorkerTitle(a.title) : "Worker"]));
  const count = new Map<string, number>();
  for (const name of base.values()) count.set(name, (count.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  const clock = (a: Attempt) => a.startedAt != null ? clockFormatter.format(new Date(a.startedAt)) : "";
  const starts = new Map<string, Set<string>>();
  for (const a of attempts) { const name = base.get(a.threadId)!; starts.set(name, (starts.get(name) ?? new Set()).add(clock(a))); }
  for (const a of [...attempts].sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0))) {
    const name = base.get(a.threadId)!;
    const total = count.get(name) ?? 0;
    if (total < 2) { names.set(a.threadId, name); continue; }
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const started = starts.get(name)!.size === total ? clock(a) : "";
    names.set(a.threadId, started ? `${name}, started ${started}` : `${name} (${n} of ${total})`);
  }
  return names;
}

function foldWords(attempts: readonly Attempt[], earlier: boolean): string {
  const states = new Map<string, number>();
  for (const a of attempts) { const state = a.state === "unknown" ? "idle" : a.state; states.set(state, (states.get(state) ?? 0) + 1); }
  const noun = `${attempts.length} ${earlier ? "earlier " : ""}${attempts.length === 1 ? "worker" : "workers"}`;
  if (states.size === 1) { const [state] = states.keys(); return `${noun}, ${attempts.length === 1 ? "" : "all "}${state}`; }
  return `${noun}: ${[...states].map(([state, n]) => `${n} ${state}`).join(", ")}`;
}

function WorkerList({ attempts, now, onOpen }: { attempts: readonly Attempt[]; now: number; onOpen: (threadId: string) => void }) {
  const [all, setAll] = useState(false);
  const names = useMemo(() => workerNames(attempts), [attempts]);
  const running = attempts.filter(a => a.state === "running");
  const rest = attempts.filter(a => a.state !== "running");
  const fold = attempts.length > WORKERS_SHOWN;
  const shown = fold && !all ? running : attempts;
  const item = (a: Attempt) => {
    const status = attemptStatus(a, now);
    const name = names.get(a.threadId) ?? "Worker";
    return <li key={a.threadId}><button type="button" className="dispatch-attempt" onClick={() => onOpen(a.threadId)} aria-label={`Open worker ${name}${status ? `, ${status}` : ""}`}>
      <span className="dispatch-attempt-head"><i aria-hidden="true" data-running={a.state === "running" || undefined} /><span className="dispatch-worker-model" dir="auto"><Isolated text={name} /></span></span>
      {status ? <span className="dispatch-attempt-title">{capitalFirst(status)}</span> : null}
    </button></li>;
  };
  return <ul className="dispatch-worker-list">
    {shown.map(item)}
    {fold ? <li><button type="button" className="dispatch-worker-fold" aria-expanded={all} onClick={() => setAll(value => !value)}>
      <span>{all ? foldWords(attempts, false) : foldWords(rest, running.length > 0)}<span className="dispatch-worker-fold-action"> · {all ? "Hide workers" : "Show workers"}</span></span>
    </button></li> : null}
  </ul>;
}
function afterStop(text: string): string {
  return text.replace(/([.!?]["\u201d\u2019)]?)\u2026$/, "$1");
}

const OUTCOME_CAP = 600;
const CORE_CAPS = [300, 600];
const CARD_ASK = 110;
const STATUS_FORMS = [140, 120, 100, 84, 70, 56];
const CARD_ASK_PHONE = 110;
const LINE_CAP = 240;
const SETTLE_MS = 450;

export function BotWorkPanel({ bot, anchor, focusDesks = false, keyboard = false, snapshot, activeThreadId, isCompactViewport, now, scope, onNavigate, onClose, onShowThreads, askerOf, originalOf }: {
  bot: BotTasksBot; anchor?: PanelAnchor; askerOf?: (threadId: string) => string | undefined; originalOf?: OriginalOf; focusDesks?: boolean; keyboard?: boolean; snapshot: WorkerSnapshot; activeThreadId: string | null; isCompactViewport: boolean; now: number; scope?: string;
  onNavigate: (id: string, messageSeq?: number) => void; onClose: () => void; onShowThreads?: () => void;
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
    if (!keyboard) { panel.current?.focus({ preventScroll: true }); return; }
    (section.querySelector<HTMLElement>(".radar-desk-row:not(:disabled), .dispatch-task") ?? panel.current)?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  }, [focusDesks]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const inside = document.activeElement instanceof Node && panel.current?.contains(document.activeElement);
      if (inside) return;
      if (document.querySelector('[role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const settle = window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !panel.current?.contains(active) && !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable)) panel.current?.focus({ preventScroll: true });
    }, SETTLE_MS + 50);
    return () => { document.removeEventListener("keydown", onKey); window.clearTimeout(settle); };
  }, []);
  useEffect(() => {
    if (!isCompactViewport) return;
    const elements = [document.documentElement, document.body, document.querySelector<HTMLElement>(".radar-list-body")].filter((node): node is HTMLElement => !!node);
    const previous = elements.map(node => node.style.overflow);
    elements.forEach(node => { node.style.overflow = "hidden"; });
    return () => elements.forEach((node, i) => { node.style.overflow = previous[i]; });
  }, [isCompactViewport]);
  const tasks = cardOrder(bot.tasks.filter(t => !isClosed(t.displayState)));
  const asks = tasks.filter(t => t.displayState === "needs");
  const laterTasks = tasks.filter(t => t.displayState !== "needs" && t.later);
  const others = tasks.filter(t => t.displayState !== "needs" && !t.later);
  const needDesks = bot.desks.filter(needsYou);
  const laterDesks = bot.desks.filter(desk => desk.later !== undefined);
  const otherDesks = bot.desks.filter(desk => !needsYou(desk) && desk.later === undefined);
  const recent = bot.tasks.filter(t => isClosed(t.displayState) && !/^TEST\b/.test(t.title) && !/^TEST fixture\b/i.test(t.outcome ?? "")).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const workerCount = snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null;
  const chatting = snapshot.chat.has(bot.key);
  const busy = (snapshot.byBot[bot.key]?.length ?? 0) > 0 || chatting || tasks.some(t => ["working", "queued"].includes(t.displayState));
  const currentDeskId = activeThreadId ? needDesks.find(desk => desk.threadId === activeThreadId)?.id : undefined;
  const currentTaskId = activeThreadId ? [...asks, ...others, ...recent].find(t => t.conversationThreadId === activeThreadId)?.id : undefined;
  const titleOf = (task: BotTaskRow) => task.displayState === "needs" && task.needs?.question && /\?/.test(task.needs.question) ? needsTopic(task.needs.question, stageTitle(task.title, task.outcome)) : isQuestionRow(task) ? questionTopic(task.needs?.question ?? task.title) : stageTitle(task.title, task.outcome);
  const askedMeta = (task: BotTaskRow) => {
    const at = task.needs?.askedAt;
    if (at === undefined) return "";
    return isOldAsk(task) ? `Old ask · ${elapsed(at, now)} · the bot has moved on since` : `Asked ${dayAndTime(at, now)}`;
  };
  const sameLook = new Map<string, number>();
  for (const task of [...tasks, ...recent]) { const key = `${titleOf(task)}\n${taskStatus(task, now)}`; sameLook.set(key, (sameLook.get(key) ?? 0) + 1); }
  const lookSeen = new Map<string, number>();
  const shownTitle = (task: BotTaskRow) => {
    const name = titleOf(task);
    const key = `${name}\n${taskStatus(task, now)}`;
    const total = sameLook.get(key) ?? 1;
    if (total < 2) return name;
    const goal = task.outcome ? stageTitle(task.outcome) : "";
    if (goal && goal !== name && goal.toLowerCase().startsWith(name.toLowerCase()) && goal.length <= 70) return goal;
    const n = (lookSeen.get(key) ?? 0) + 1;
    lookSeen.set(key, n);
    return `${name} (${n} of ${total})`;
  };
  const parkFrom = (from: HTMLElement, taskId: string, act: () => Promise<void>) => {
    const card = from.closest("article");
    const siblings = Array.from(card?.parentElement?.querySelectorAll<HTMLElement>(":scope > article") ?? []);
    const at = card ? siblings.indexOf(card) : -1;
    const next = siblings[at + 1] ?? siblings[at - 1];
    void act();
    requestAnimationFrame(() => {
      const target = next?.isConnected ? next.querySelector<HTMLElement>(".dispatch-task") : panel.current?.querySelector<HTMLElement>(`article[data-task="${taskId}"] .dispatch-task`);
      (target ?? panel.current)?.focus({ preventScroll: false });
    });
  };
  const noteOwner = new Map<string, string>();
  for (const task of [...tasks, ...recent]) {
    const reason = detailReason(stageText(task.needs?.question ?? task.line, task.displayState === "needs"));
    const owner = noteOwner.get(reason);
    const busyHere = (snapshot.byTask[task.id] ?? []).some(a => a.state === "running");
    if (!owner || busyHere && !(snapshot.byTask[owner] ?? []).some(a => a.state === "running")) noteOwner.set(reason, task.id);
  }
  const taskRow = (task: BotTaskRow) => {
    const tone = /^(Cancelled|Stopped)\b/.test(taskStatus(task, now)) ? "ended" : isOldAsk(task) ? "quiet" : stateTone(task.displayState);
    const name = shownTitle(task);
    const attempts = snapshot.byTask[task.id] ?? [];
    const running = attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId);
    const waitsOn = running.length ? null : idleWait(task, bot, snapshot, now);
    const laterNote = task.displayState === "waiting" && task.laterNote ? task.laterNote : null;
    const baseStatus = task.displayState === "needs" ? fitWhat(cardStatus(task, running, now, waitsOn), isCompactViewport ? CARD_ASK_PHONE : CARD_ASK) : cardStatus(task, running, now, waitsOn);
    const laterHead = laterNote ? capitalFirst(readableCut(readerWords(plainNote(laterNote.text)).split(/(?<=[.!?])\s+/)[0]!, 80).replace(/[.]$/, "")) : "";
    const status = laterNote ? `${laterHead} \u00b7 ${dayAndTime(laterNote.at, now)}` : baseStatus;
    const options = task.displayState === "needs" ? (task.needs?.options ?? []).filter(Boolean).slice(0, 4) : [];
    const reason = detailReason(stageText(task.needs?.question ?? task.line, task.displayState === "needs"));
    const question = isQuestionRow(task);
    const told = task.ask ? askParts(task.ask, now, askerOf, bot.name, originalOf) : null;
    const offTopic = told?.kind === "update" && !sameJob(task.ask!.full ?? task.ask!.excerpt, [task.title, task.outcome ?? "", ...attempts.map(a => a.title)]);
    const parts = offTopic ? null : told;
    const needsCard = task.displayState === "needs";
    const ask = task.ask && parts && !needsCard ? askLine(task.ask, now, askerOf, ASK_PREVIEW, bot.name, originalOf) : "";
    const bare = (text: string) => text.replace(/\u2026$/, "").trim();
    const fullAsk = parts && parts.full && (needsCard || bare(parts.full).length > bare(cutAtWord(parts.quote, ASK_PREVIEW)).length + 3 || parts.excerpt) ? parts : null;
    const askOpen = openAsks.has(task.id);
    const toggleDetails = () => setOpenAsks(prev => { const next = new Set(prev); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; });
    const shownWorkers = new Set(attempts.map(a => plainWorkerTitle(a.title).toLowerCase()));
    const goalText = task.outcome && task.outcome !== task.title ? readerWords(plainNote(task.outcome)).replace(/^([^.!?]*[^.!?\s])\.$/, "$1") : "";
    const flatWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const repeatsTitle = !!goalText && (flatWords(goalText) === flatWords(name) || stageTitle(task.outcome!) === name && goalText.length <= name.length + 16);
    const fragment = !!goalText && goalText.split(/\s+/).length < 6 && (task.outcome ?? "").length > goalText.length + 10;
    const goal = goalText && !repeatsTitle && !fragment && !shownWorkers.has(goalText.toLowerCase()) ? goalText : "";
    const capped = !!task.outcome && CORE_CAPS.includes(task.outcome.length) && !/[.!?]$/.test(task.outcome.trim());
    const outcome = goal ? capped ? cutAtWord(`${goal}\u2026`, goal.length) : capCut(goal, OUTCOME_CAP - (task.outcome!.length - goal.length)) : "";
    const goalCut = !!outcome && /\u2026$/.test(outcome);
    const said = !question && noteOwner.get(reason) === task.id ? closedNote(task, reason) : "";
    const split = yourAskSplit(said);
    const shownSaid = split ? split.status : said;
    const stale = running.length > 0 && /^(?:Starts when|Not started yet|Its (?:browser test|next step) hasn't started|Queued\b|Next check\b)/i.test(shownSaid);
    const extra = shownSaid && !stale && !CRITERIA.test(shownSaid) && !status.includes(shownSaid) && !shownSaid.startsWith(status) ? capCut(shownSaid, task.line.length >= LINE_CAP - 1 ? 0 : Infinity) : "";
    const extraCut = /\u2026$/.test(extra);
    const yours = parts?.kind === "yours";
    const arm = () => { const place = askPlace(task, bot.coordinatorThreadId); armAskStrip({ key: `ask:${task.id}`, threadId: place.threadId, messageSeq: place.messageSeq, question: cardStatus(task, running, now, waitsOn), title: name, options: answerOptions(task.needs?.options), botName: bot.name, askedAt: task.needs?.askedAt }); return place; };
    const go = () => { if (task.displayState === "needs") { const place = arm(); onNavigate(place.threadId, place.messageSeq); } else onNavigate(task.conversationThreadId ?? bot.coordinatorThreadId); };
    const label = notNowLabel({ botName: bot.name, title: name, what: task.displayState === "needs" ? status : question ? task.needs?.question ?? name : name, options: task.needs?.options });
    return <article key={task.id} className="dispatch-task-group dispatch-card" data-tone={tone} data-task={task.id}>
      <div className="dispatch-card-head">
        <button type="button" className="dispatch-task" aria-current={task.id === currentTaskId ? "page" : undefined} aria-label={`${name}. ${status}`} onClick={go}>
          <b dir="auto"><Isolated text={name} /></b>
        </button>
        {task.displayState === "needs" ? <button type="button" className="dispatch-later-action radar-not-now" aria-label={`Not now: ${label}`} title="Not now: move to Later until the bot asks again" onClick={event => parkFrom(event.currentTarget, task.id, () => notNow(taskNotNowKey(task), label))}><span className="radar-not-now-pill">Not now</span></button>
          : task.later?.reason === "not-now" ? <button type="button" className="dispatch-later-action radar-not-now" aria-label={`Bring back: ${label}`} title="Put it back in Needs you" onClick={event => parkFrom(event.currentTarget, task.id, () => bringBack(taskNotNowKey(task), label))}><span className="radar-not-now-pill">Bring back</span></button> : null}
        <button type="button" className="dispatch-task-continue" aria-label={question && questionInPanel(task) ? `Reply to ${name} in the bot's chat` : `Continue ${name}`} title={question && questionInPanel(task) ? "The bot asked this outside its chat; reply to it in its chat" : question ? "Answer in the bot's chat" : "Continue in the bot's chat"} onClick={() => {
          if (question) { const place = needsCard ? arm() : askPlace(task, bot.coordinatorThreadId); onNavigate(place.threadId, place.messageSeq); return; }
          window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: name.slice(0, 80) } }));
          onNavigate(bot.coordinatorThreadId);
        }}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />{question && questionInPanel(task) ? "Reply in chat" : "Continue"}</span></button>
      </div>
      <div className="dispatch-card-ask" aria-hidden="true" onClick={go}><span className="dispatch-status-line"><i aria-hidden="true" />{needsCard ? <FitLines forms={askForms(cardStatus(task, running, now, waitsOn), STATUS_FORMS, fitWhat, name, options.length)} /> : <span dir="auto"><Isolated text={question ? `${task.needs?.question ?? ""} \u00b7 ${status}` : status} /></span>}</span></div>
      {options.length ? <div className="dispatch-options" role="group" aria-label={`Answers to ${name}`}>
        <span className="dispatch-options-label" aria-hidden="true">Answer here or in chat</span>
        {options.map(option => <button key={option} type="button" className="dispatch-option" aria-label={`Reply “${option}” in the chat: opens the chat with it typed, ready to send`} title="Opens the chat with this reply typed, ready to send" onClick={() => {
          const place = arm();
          requestFill(place.threadId, option, options);
          onNavigate(place.threadId, place.messageSeq);
        }}><Isolated text={plainNote(option)} /></button>)}
      </div> : null}
      {(question || needsCard || isOldAsk(task)) && !ask && askedMeta(task) ? <p className="dispatch-ask-line" dir="auto" data-old={isOldAsk(task) || undefined}><span className="dispatch-ask-text"><Isolated text={askedMeta(task)} /></span></p> : null}
      {ask ? fullAsk || outcome || extra || split || attempts.length ? <button type="button" className="dispatch-ask-line" dir="auto" aria-expanded={askOpen} aria-controls={`dispatch-details-${task.id}`} title={askOpen ? "Hide details" : "Show the full ask and details"} onClick={toggleDetails}><span className="dispatch-ask-text"><Isolated text={ask} /></span></button>
        : <p className="dispatch-ask-line" dir="auto"><span className="dispatch-ask-text"><Isolated text={ask} /></span></p> : null}
      {outcome || extra || split || attempts.length || fullAsk || laterNote ? <details className="dispatch-details" id={`dispatch-details-${task.id}`} open={askOpen} onToggle={event => { const open = (event.currentTarget as HTMLDetailsElement).open; if (open !== askOpen) toggleDetails(); }}>
        <summary>Details<Icon name="ChevronDown" aria-hidden="true" /></summary>
        {fullAsk ? <p className="dispatch-full" dir="auto"><span>{fullAsk.excerpt ? `${fullAsk.head} · ${fullAsk.part ?? "excerpt"}` : fullAsk.kind === "yours" || fullAsk.kind === "ask" ? `${fullAsk.head}, in full` : fullAsk.head}</span><Isolated text={`\u201c${fullAsk.full}\u201d`} /></p> : null}
        {outcome ? <p className="dispatch-full" dir="auto"><span>{goalCut ? "Goal · excerpt" : "Goal"}</span><Isolated text={afterStop(outcome)} /></p> : null}
        {laterNote ? <p className="dispatch-full" dir="auto"><span>{`From the bot, ${dayAndTime(laterNote.at, now)}`}</span><Isolated text={`\u201c${readerWords(plainNote(laterNote.text))}\u201d`} /></p> : null}
        {laterNote ? <p className="dispatch-full" dir="auto"><span>Before that</span><Isolated text={baseStatus} /></p> : null}
        {split ? <p className="dispatch-full" dir="auto"><span>Your standing instruction</span><Isolated text={`\u201c${split.asked}\u201d`} /></p> : null}
        {extra ? extraCut ? <p className="dispatch-full" dir="auto"><span>Latest note · excerpt</span><Isolated text={afterStop(extra)} /></p> : <p className="dispatch-full-status" dir="auto"><Isolated text={extra} /></p> : null}
        {attempts.length ? <WorkerList attempts={attempts} now={now} onOpen={onNavigate} /> : null}
        {task.ask ? <button type="button" className="dispatch-ask-open" onClick={() => onNavigate(task.ask!.ref.threadId)}>{fullAsk?.excerpt ? "Read the whole message in chat" : "Open in chat"}</button> : null}
      </details> : null}
    </article>;
  };
  const hue = botStyle(bot.key, bot.name).hue;
  const blockedNow = tasks.some(t => BLOCKED.includes(t.displayState));
  const anchored = anchor && !isCompactViewport;
  return createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}${anchored ? " dispatch-anchored" : ""}`} data-bb-portaled-overlay="" data-bb-plugin={scope} onClickCapture={event => { if (isCompactViewport && performance.now() - openedAt.current < SETTLE_MS) { event.preventDefault(); event.stopPropagation(); } }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dispatch-panel" data-caret={anchored && anchor?.rowCenter !== undefined || undefined} style={{ "--bot-hue": hue, ...(anchored ? anchoredStyle(anchor) : {}) } as CSSProperties} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: tasks and desks`} onKeyDown={event => {
    if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) return;
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") { const buttons = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => { const closed = node.closest("details:not([open])"); return !closed || node.parentElement === closed && node.tagName === "SUMMARY"; }).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1); const first = buttons[0], last = buttons.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    {isCompactViewport ? <button className="dispatch-grabber" aria-label="Close work panel" onClick={onClose} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) onClose(); drag.current = null; }}><span /></button> : null}
    <header className="dispatch-panel-head"><span className="dispatch-panel-face"><BotTaskFace bot={bot} size={40} state={blockedNow ? "failed" : busy ? "working" : undefined} /></span><div><h2>{bot.name}</h2><p className="dispatch-panel-summary">{panelSummary({ asks: asks.filter(t => !isOldAsk(t)).length + needDesks.length, old: asks.filter(isOldAsk).length, tasks: others.length + bot.unlinked.length, later: laterTasks.length + laterDesks.length, workers: workerCount }, chatting).split(" \u00b7 ").map((part, i, all) => <span key={i}>{part}{i < all.length - 1 ? " \u00b7 " : ""}</span>)}</p></div><button className="dispatch-close" aria-label={`Close ${bot.name}`} onClick={onClose}><Icon name="X" aria-hidden="true" /></button></header>
    <nav className="dispatch-panel-actions" aria-label={`${bot.name} actions`}>
      {activeThreadId === bot.coordinatorThreadId ? null : <button className="dispatch-chat-pill" onClick={() => onNavigate(bot.coordinatorThreadId)}><Icon name="MessageSquare" aria-hidden="true" />Chat</button>}
      <a className="dispatch-automations" href={automationsHref(bot.key)} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(); }}><Icon name="Clock" aria-hidden="true" />Automations</a>
      <BotMenu thread={target} botName={bot.name} onShowThreads={() => { window.dispatchEvent(new Event("radar:show-all-threads")); onShowThreads?.(); }} onClose={onClose} />
    </nav>
    <div className="dispatch-panel-body" ref={body}>
    {asks.length || needDesks.length ? <section className="dispatch-needs" ref={desksRef} aria-label="Needs you">
      <header className="dispatch-section-head dispatch-needs-head"><h3>Needs you</h3><span>{asks.length + needDesks.length}</span></header>
      {asks.length ? <div className="dispatch-open">{asks.map(taskRow)}</div> : null}
      {needDesks.length ? <div className="dispatch-open">{needDesks.map(desk => <DeskNeedCard key={desk.id} desk={desk} now={now} botName={bot.name} current={!currentTaskId && desk.id === currentDeskId} onOpen={onNavigate} />)}</div> : null}
    </section> : null}
    {tasks.filter(t => BLOCKED.includes(t.displayState)).map(t => <div className="dispatch-block-card" key={t.id}><b dir="auto">Stuck · <Isolated text={stageTitle(t.title)} /></b><p>{detailReason(rowDetail(t, now)) || STATE_LABEL[t.displayState]}{t.retryAt ? ` · Retry ${new Date(t.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</p></div>)}
    {others.length || bot.unlinked.length ? <><header className="dispatch-section-head"><h3>Tasks</h3><span>{others.length + bot.unlinked.length}</span></header><div className="dispatch-open">{others.map(taskRow)}{bot.unlinked.map(w => <article className="dispatch-task-group" data-tone="busy" key={w.threadId}><button className="dispatch-task" onClick={() => onNavigate(w.threadId)}><span className="dispatch-status-line"><i aria-hidden="true" />Working outside a task</span><b dir="auto">{taskHeadline(plainWorkerTitle(w.title || "Worker"))}</b></button></article>)}</div></> : asks.length || laterTasks.length ? null : <p className="dispatch-idle">{recent[0]?.completedAt ? `No open tasks · last one finished ${ago(recent[0].completedAt, now)}` : "No open tasks"}</p>}
    <DeskThreads desks={otherDesks} now={now} onOpen={onNavigate} />
    <ClaimedThreads threads={claims.byBot[bot.key] ?? []} onOpen={onNavigate} />
    {laterTasks.length || laterDesks.length ? <section className="dispatch-later" aria-label="Later">
      <header className="dispatch-section-head"><h3>Later</h3><span>{laterTasks.length + laterDesks.length}</span></header>
      <div className="dispatch-open">{laterTasks.map(taskRow)}{laterDesks.map(desk => <DeskNeedCard key={desk.id} desk={desk} now={now} botName={bot.name} current={false} onOpen={onNavigate} />)}</div>
    </section> : null}
    <header className="dispatch-section-head"><h3>Recent</h3>{recent.length ? <span>{recent.length}</span> : null}</header>{recent.length ? <div className="dispatch-recent">{(allRecent ? recent : recent.slice(0, RECENT_SHOWN)).map(taskRow)}</div> : <p className="dispatch-idle">No recent tasks</p>}
    {recent.length > RECENT_SHOWN ? <button type="button" className="dispatch-recent-more" aria-expanded={allRecent} onClick={() => setAllRecent(value => !value)}>{allRecent ? "Show fewer" : `Show all ${recent.length}`}</button> : null}
    </div>
  </div></div>, document.body);
}
