import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  STATE_LABEL,
  crewStatus,
  feedBands,
  isClosed,
  isSameLocalDay,
  layoutBot,
  localizeDoneLine,
  needRows,
  orderedBots,
  rowStartedAt,
  shortModel,
  type Attempt,
  type Band,
  type BotLayout,
  type CrewTone,
  type BotMood,
  type FeedItem,
  type BotTaskRow,
  type BotTasksBot,
  type BotTasksData,
  type NeedRow,
} from "@/lib/botTasks";
import { botStyle, shortBotName, type BotState } from "./bots";
import type { CSSProperties } from "react";
import { BotFace } from "./BotFace";
import { shortAgo } from "./time";
import type { BotTasksState } from "./useBotTasks";
import { useTaskAttempts } from "./useTaskAttempts";
import { readStored, writeStored } from "./useListSettings";

/** Needs rows shown on a desktop before "See all"; a phone always shows every decision. */
export const NEEDS_SHOWN = 3;
/** Not filed rows rendered before the rest are left to the Threads list. */
const NOT_FILED_SHOWN = 30;
const FOLDS_KEY = "radar-sidebar:bots-folds:v2";
const PEEK_DELAY_MS = 350;

// 24-hour, like the waiting rows' "tonight 20:30" (a finished row read "5:54 PM" next to them).
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const DAY_MS = 86_400_000;

/** A finished row's age column: its time today, its weekday earlier this week, its date beyond that. */
export function closedAge(completedAt: number, now: number): string {
  if (isSameLocalDay(completedAt, now)) return timeFormatter.format(new Date(completedAt));
  return (now - completedAt < 6 * DAY_MS ? weekdayFormatter : dateFormatter).format(new Date(completedAt));
}

/** A copy from an earlier day says which day, so yesterday's tasks never read as current. */
export function asOf(observedAt: number, now: number): string {
  return (isSameLocalDay(observedAt, now) ? timeFormatter : dateTimeFormatter).format(new Date(observedAt));
}

function readFolds(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/** A bot's still face: its faceUrl, its mascot for the named crew, else its initial in its colour. No WebGL. */
export function BotTaskFace({ bot, size = 20, state }: { bot: Pick<BotTasksBot, "key" | "name" | "color" | "faceUrl">; size?: number; state?: BotState }) {
  const [broken, setBroken] = useState(false);
  if (bot.faceUrl && !broken) {
    return <img className="radar-tasks-face" src={bot.faceUrl} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
  }
  const style = botStyle(bot.key, bot.name);
  if (style.mascot) return <span className="radar-tasks-face" style={{ width: size, height: size }}><BotFace botKey={bot.key} name={bot.name} state={state} size={size} /></span>;
  return (
    <span className="radar-tasks-face radar-tasks-face-letter" style={{ width: size, height: size, background: bot.color ?? `hsl(${style.hue} 55% 45%)` }}>
      {shortBotName(bot.name).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The expression a bot's hero face wears for its mood: the crew's own face language, not a new one. */
export function moodFace(mood: BotMood): BotState | undefined {
  if (mood === "needs") return "needs-you";
  if (mood === "overdue") return "failed";
  if (mood === "offline") return "unavailable";
  if (mood === "working" || mood === "checking") return "working";
  return undefined;
}

/**
 * A waiting row's second line says what it waits for, not only whom: the core
 * writes "Waiting for the bot: <reason> · wakes 09:00", and the hollow ring
 * already says "waiting", so the row keeps the reason and drops the preamble.
 * A wait on a person keeps the name in front of the reason.
 */
export function waitingLine(task: Pick<BotTaskRow, "line" | "waitFor">): string {
  const owner = task.waitFor ?? "";
  const prefix = `Waiting for ${owner}: `;
  const reason = task.line.startsWith(prefix) ? task.line.slice(prefix.length).trim() : "";
  if (!reason) return task.line || (owner ? `Waiting for ${owner}` : STATE_LABEL.waiting);
  return owner && owner !== "the bot" ? `${owner}: ${reason}` : reason;
}

/**
 * What the row shows after its coloured state word: the wait's owner or
 * reason, the question, the progress line. A line that opens with the state
 * itself ("Queued: no capacity") loses that preamble; the word already shows.
 */
const DONE_DAY = /^Done (today|\d{1,2} \S+|\S+ \d{1,2})(?:\s*[·:]\s*|$)/;

/** The coloured word that opens a row's second line: the state, with its local day for a finished task. */
export function rowStateWord(task: BotTaskRow, now: number): string {
  const day = isClosed(task.displayState) ? DONE_DAY.exec(localizeDoneLine(task, now))?.[1] : undefined;
  return day ? `${STATE_LABEL[task.displayState]} ${day}` : STATE_LABEL[task.displayState];
}

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clearsWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayMonthFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
/**
 * When a waiting row clears, in the device's own day (Salem, 2026-10-29: "Show when it clears instead of the reason"):
 * "tonight 20:30", "tomorrow 07:00", "Sat 1 Nov" after the Waiting word, short enough for a phone row (the time was cut off
 * with "checks" in front); a passed date reads as overdue. The reason itself is in the row's details.
 */
export function clearsLine(at: number, now: number): string {
  const day = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(at) - day(now)) / 86_400_000), time = clockFormatter.format(new Date(at));
  if (at < now) return days === 0 ? `overdue since ${time}` : `overdue since ${dayMonthFormatter.format(new Date(at))}`;
  if (days === 0) return `${new Date(at).getHours() >= 17 ? "tonight" : "today"} ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${clearsWeekdayFormatter.format(new Date(at))} ${time}`;
  return dayMonthFormatter.format(new Date(at));
}

export function rowDetail(task: BotTaskRow, now: number): string {
  const label = STATE_LABEL[task.displayState];
  if (task.displayState === "waiting" && task.wakeAt !== undefined) return clearsLine(task.wakeAt, now);
  // A wait on the bot itself with no date: said plainly, not hidden behind a nudge time (Salem, 2026-10-29: one reminder
  // system). A wait on someone else keeps naming them; it has no date of its own.
  if (task.displayState === "waiting" && task.waitFor === "the bot") return "no date";
  if (task.displayState === "waiting") {
    const line = waitingLine(task);
    return line === STATE_LABEL.waiting ? "" : line.replace(/^Waiting for /, "");
  }
  const line = localizeDoneLine(task, now) || task.needs?.question || "";
  if (line === label) return "";
  // A closed row's "Done today" or "Done 28 Oct" preamble is the state word and the age column over again.
  if (isClosed(task.displayState)) return line.replace(DONE_DAY, "");
  return line.replace(new RegExp(`^${label}[:·]\\s*`, "i"), "");
}

/** One chevron for every fold in the view, from the project's icon family. */
function Chevron({ open }: { open: boolean }) {
  return <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden="true" className="radar-tasks-chevron-icon" />;
}

function rowAge(task: BotTaskRow, observedAt: number, now: number): string {
  if (task.completedAt !== undefined && isClosed(task.displayState)) return closedAge(task.completedAt, now);
  return shortAgo(rowStartedAt(task, observedAt), now);
}

/** When an attempt ran: "Started 14:02" while it runs, "14:02 · ended 14:40" after; another day's start says its day. */
export function attemptWhen(attempt: Pick<Attempt, "startedAt" | "endedAt" | "state">, now: number): string {
  if (attempt.startedAt === null) return "";
  const started = (isSameLocalDay(attempt.startedAt, now) ? timeFormatter : dateTimeFormatter).format(new Date(attempt.startedAt));
  if (attempt.state === "running" || attempt.endedAt === null) return `Started ${started}`;
  const ended = (isSameLocalDay(attempt.endedAt, attempt.startedAt) ? timeFormatter : dateTimeFormatter).format(new Date(attempt.endedAt));
  return `${started} · ended ${ended}`;
}

/** The thread's status as a word: bb's "running" and "idle", anything else as the core sent it. */
export function attemptStateWord(state: string): string {
  if (state === "running") return "Running";
  if (state === "idle") return "Ended";
  if (state === "unknown") return "Unknown";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/**
 * A task's details under its row: what it is, then every attempt (worker)
 * newest first with its model, effort and times, each opening its thread.
 * The core sends no per-attempt result line; the thread's state stands in.
 */
function TaskInfo({ id, task, now, observedAt, activeThreadId, onOpen }: {
  id: string; task: BotTaskRow; now: number; observedAt: number; activeThreadId: string | null; onOpen: (threadId: string) => void;
}) {
  const { status, attempts } = useTaskAttempts(task, observedAt);
  const label = STATE_LABEL[task.displayState] + (task.displayState === "waiting" && task.waitFor ? ` for ${task.waitFor}` : "");
  const age = rowAge(task, observedAt, now);
  const line = localizeDoneLine(task, now);
  return (
    <div id={id} className="radar-task-info" role="region" aria-label={`${task.title || "Untitled task"}: details`}>
      <p className="radar-task-info-meta">
        <span className={cn("radar-task-state", `radar-task-state-${task.displayState}`)}>{label}</span>
        {` · ${isClosed(task.displayState) ? `finished ${age}` : `started ${age} ago`}`}
      </p>
      {line && line !== STATE_LABEL[task.displayState] ? <bdi dir="auto" className="radar-task-info-line">{line}</bdi> : null}
      {task.needs ? <bdi dir="auto" className="radar-task-info-line">Asks: {task.needs.question}</bdi> : null}
      {task.origin !== "verified" ? <p className="radar-task-info-meta">{task.origin === "imported" ? "Filed from history" : "Not confirmed as yours: filed only"}</p> : null}
      <div className="radar-task-info-head">
        <span>Attempts</span>
        <span className="radar-task-info-count">{status === "loading" && attempts.length === 0 ? "…" : attempts.length}</span>
      </div>
      {status === "missing" ? <p className="radar-task-info-note">This core doesn't list attempts yet; only the latest is known.</p> : null}
      {status === "error" ? <p className="radar-task-info-note">Attempts didn't load; only the latest is known.</p> : null}
      {attempts.length === 0 && status !== "loading" ? <p className="radar-task-info-note">No worker yet: this is the bot's own step.</p> : null}
      {attempts.length > 0 ? (
        <ul className="radar-task-attempts">
          {attempts.map(attempt => {
            const running = attempt.state === "running";
            const state = attemptStateWord(attempt.state);
            const model = shortModel(attempt.model) + (attempt.effort ? ` · ${attempt.effort}` : "");
            const when = attemptWhen(attempt, now);
            return (
              <li key={attempt.threadId}>
                <button type="button" className={cn("radar-task-attempt", running && "radar-task-attempt-running")} data-attempt-thread={attempt.threadId}
                  aria-current={activeThreadId !== null && attempt.threadId === activeThreadId ? "page" : undefined}
                  aria-label={`${attempt.title}, ${state}${model ? `, ${model}` : ""}${when ? `, ${when}` : ""}${attempt.latest ? ", latest attempt" : ""}`}
                  onClick={() => onOpen(attempt.threadId)}>
                  <span className={cn("radar-task-glyph", running ? "radar-task-glyph-working" : "radar-task-glyph-ended")} aria-hidden="true" />
                  <span className="radar-task-body">
                    <span className="radar-task-titleline">
                      <bdi dir="auto" className="radar-task-title">{attempt.title}</bdi>
                      {attempt.latest ? <span className="radar-task-chip radar-task-chip-latest">latest</span> : null}
                    </span>
                    <span className="radar-task-line">
                      <span className={cn("radar-task-state", running && "radar-task-state-working")}>{state}</span>
                      {model ? <span className="radar-task-detail">{model}</span> : null}
                    </span>
                    {when ? <span className="radar-task-line radar-task-when">{when}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

interface Peek { task: BotTaskRow; bot: BotTasksBot; age: string; top: number; left: number }

/** The bot's own colour, for the stage its character stands on: identity, not state. */
export function botTint(bot: Pick<BotTasksBot, "key" | "name" | "color">): string {
  return bot.color ?? `hsl(${botStyle(bot.key, bot.name).hue} 70% 55%)`;
}

/** The bot's sheet, which its desk opens and controls. */
const BOT_SHEET_ID = "radar-bot-sheet";

/** What a desk's laptop shows: work scrolling, a red "!", a "?" waiting on Salem, a dim idle screen, or off. */
const SCREEN: Record<CrewTone, "work" | "alert" | "ask" | "idle" | "off"> = { busy: "work", trouble: "alert", ask: "ask", idle: "idle", quiet: "off" };

/**
 * How long a touch holds a desk before its menu opens instead of a tap: bb's own long-press time (bb 0.48's
 * compact menu trigger uses 700ms), so a desk answers a hold exactly like a thread row does and a slow tap of
 * half a second is still a tap. bb runs that detector itself on phones; the desk's own keeps the menu
 * reachable where the host has none (and in the SDK's test runtime).
 */
export const LONG_PRESS_MS = 700;
/** A touch that drifts further than this is a scroll, not a press. */
const PRESS_SLOP_PX = 10;

/**
 * A desk's menu: what the host wraps around the desk (bb's thread menu for the bot's coordinator, with the
 * desk's own items inline). It opens on the `contextmenu` event: a right-click, Android's native long-press,
 * or the long-press the desk detects itself (iOS fires no contextmenu on a long-press). Without one the desk
 * only opens its sheet.
 */
export interface DeskMenuProps {
  bot: BotTasksBot;
  children: ReactNode;
  onOpenChat: () => void;
}
export type DeskMenu = (props: DeskMenuProps) => ReactNode;

/** Opens a desk's menu the way a right-click would, at a point on screen. */
function openMenuAt(element: Element, x: number, y: number): void {
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
}

/** After a held touch lifts, clicks are swallowed this long, or until the next touch comes down. */
const SWALLOW_AFTER_LIFT_MS = 600;

/**
 * The desk's press handling, on the element that holds both of its buttons: a held touch opens the menu and
 * the clicks the browser sends when that touch lifts are swallowed before either button sees them (Chromium
 * sends one, iOS may), so neither the chat nor the sheet opens under the menu (Salem, thr_2gjivwx8ea seq
 * 2358). The next touch starts fresh. A touch that moves is a scroll and does nothing. Taps go through to
 * whichever button was tapped.
 */
function useDeskPress() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const menuOpened = useRef(false);
  const dispatching = useRef(false);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const armRelease = () => {
    if (swallowClick.current) release.current = setTimeout(() => { swallowClick.current = false; release.current = null; }, SWALLOW_AFTER_LIFT_MS);
  };
  useEffect(() => () => { cancel(); if (release.current) clearTimeout(release.current); }, []);
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (release.current) clearTimeout(release.current);
      release.current = null;
      swallowClick.current = false;
      menuOpened.current = false;
      if (event.pointerType === "mouse") return;
      const target = event.currentTarget;
      const { clientX: x, clientY: y } = event;
      start.current = { x, y };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        swallowClick.current = true;
        if (menuOpened.current) return;
        menuOpened.current = true;
        dispatching.current = true;
        try { openMenuAt(target, x, y); } finally { dispatching.current = false; }
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > PRESS_SLOP_PX) cancel();
    },
    onPointerUp: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      start.current = null;
      armRelease();
    },
    onPointerCancel: () => { cancel(); armRelease(); },
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      if (dispatching.current) return;
      // A touch-held desk on Android gets the browser's own contextmenu too: it opens the menu once and
      // eats the click that follows; a second one for the same press is dropped.
      if (start.current || timer.current || swallowClick.current) {
        if (menuOpened.current) { event.preventDefault(); event.stopPropagation(); return; }
        menuOpened.current = true;
        swallowClick.current = true;
        cancel();
      }
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/**
 * A bot at its desk in the studio, acting out its state: typing at a glowing laptop while it works, standing
 * up in a warm light with a speech bubble when it needs Salem, a red light on the desk when something is
 * stuck, asleep with the screen off when there is nothing to do. The plate says the state in words, so the
 * scene is decoration over plain labels.
 *
 * Two taps (Salem, thr_2gjivwx8ea: "Before a click would show a context menu with tasks and click to chat that
 * was useful", then "I wanted that AND a click to open the bot chat directly"): the character, with a chat
 * badge at its side, opens the bot's chat; the name plate, a tab with a caret, opens and closes the bot's work
 * sheet under the room and wears the ring while it is open. A hold or right-click anywhere on the desk opens
 * bb's thread menu for the bot instead.
 */
function Desk({ layout, compact, onShowWork, onOpenChat, sheetOpen, chatOpen, Menu }: {
  layout: BotLayout; compact: boolean; onShowWork: () => void; onOpenChat: () => void; sheetOpen: boolean; chatOpen: boolean; Menu?: DeskMenu;
}) {
  const { bot } = layout;
  const status = crewStatus(layout);
  const tone = status.tone;
  const asks = tone === "ask" ? status.count : bot.tasks.filter(task => task.displayState === "needs").length;
  const name = shortBotName(bot.name);
  const press = useDeskPress();
  const deskRef = useRef<HTMLDivElement>(null);
  const desk = (
    <div ref={deskRef} className={cn("radar-desk", `radar-desk-${tone}`)} style={{ "--radar-bot": botTint(bot) } as CSSProperties}
      data-bot={bot.key} data-mood={layout.mood} {...press}>
      <button type="button" className="radar-desk-chat" aria-current={chatOpen ? "page" : undefined}
        aria-label={`Open ${bot.name} chat`} onClick={onOpenChat}>
        {asks > 0 ? <span className="radar-desk-bubble" aria-hidden="true">{asks > 1 ? `${asks} ?` : "?"}</span> : null}
        <span className="radar-desk-char" aria-hidden="true">
          <BotTaskFace bot={bot} size={compact ? 54 : 48} state={moodFace(layout.mood)} />
          <span className="radar-desk-chat-badge"><Icon name="MessageSquare" aria-hidden="true" className="radar-desk-chat-icon" /></span>
        </span>
        <span className="radar-desk-top" aria-hidden="true">
          <span className={cn("radar-desk-laptop", `radar-desk-laptop-${SCREEN[tone]}`)}><i /><i /><i /></span>
          {tone === "trouble" ? <span className="radar-desk-siren" /> : <span className="radar-desk-mug" />}
        </span>
      </button>
      <button type="button" className="radar-desk-front" aria-expanded={sheetOpen} aria-controls={sheetOpen ? BOT_SHEET_ID : undefined}
        aria-label={`Show ${name}'s work: ${layout.summary}`} onClick={onShowWork}>
        <span className="radar-desk-name" dir="auto">{name}</span>
        <span className="radar-desk-status">{status.label}</span>
        <Icon name="ChevronDown" aria-hidden="true" className="radar-desk-caret" />
      </button>
    </div>
  );
  return (
    <li className="radar-desk-slot">
      {Menu ? <Menu bot={bot} onOpenChat={onOpenChat}>{desk}</Menu> : desk}
      {Menu ? (
        // The menu for keyboards and screen readers: the same menu a long-press or right-click opens.
        <button type="button" className="radar-desk-more" aria-label={`More for ${bot.name}`} aria-haspopup="menu"
          onClick={event => {
            event.stopPropagation();
            const box = deskRef.current?.getBoundingClientRect();
            if (deskRef.current && box) openMenuAt(deskRef.current, box.left + box.width / 2, box.top + box.height / 2);
          }}>
          <Icon name="MoreHorizontal" aria-hidden="true" className="radar-desk-more-icon" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * A row's parts with a separator element between them, not a ::before inside each part: inside an isolated
 * part the dot sat at that text's own start, the wrong side of an English detail in an RTL page.
 */
function joined(parts: readonly ReactNode[]): ReactNode[] {
  return parts.filter(Boolean).flatMap((part, index) => index === 0 ? [part] : [<span key={`sep${index}`} className="radar-sep" aria-hidden="true">·</span>, part]);
}

/** Bands that are live work always show; waits and history fold to their count. */
const ALWAYS_OPEN: ReadonlySet<Band["key"]> = new Set(["stuck", "working", "next"]);
/** The prefix stored folds carry across the crew; a bot's sheet keeps its own under the bot's key. */
const FOLD_SCOPE = "@all";

/**
 * The Bots view of the sidebar, a studio (Salem, thr_2gjivwx8ea: "go with studio"):
 * every bot at its own desk acting out its state, a whiteboard with the day's
 * counts, then what needs Salem (each ask with its answers, always listed), then
 * one list of what is happening across the crew, grouped by state. A desk opens
 * its bot's chat. Every row opens bb's own thread route; nothing here
 * changes a task.
 */
export function BotsView({
  state,
  activeThreadId,
  isCompactViewport,
  now,
  onOpen,
  onReply,
  onShowThreads,
  deskMenu,
}: {
  state: BotTasksState;
  activeThreadId: string | null;
  isCompactViewport: boolean;
  now: number;
  onOpen: (threadId: string) => void;
  /** Open a thread with a reply typed into its composer, unsent. Without it an answer just opens the thread. */
  onReply?: (threadId: string, text: string) => void;
  onShowThreads: () => void;
  /** The bot menu each desk wears (long-press, right-click, or its "⋯"); the plugin passes bb's thread menu. */
  deskMenu?: DeskMenu;
}) {
  const { data, status } = state;
  if (status === "missing") {
    return (
      <div className="radar-tasks-fallback" role="status">
        <p>This bots core has no task list yet.</p>
        <button type="button" className="radar-tasks-fallback-action" onClick={onShowThreads}>Show threads</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="radar-tasks-fallback" role="status">
        <p>{status === "error" ? "Bot tasks didn't load. Retrying automatically." : "Loading the bots' tasks…"}</p>
        <button type="button" className="radar-tasks-fallback-action" onClick={onShowThreads}>Show threads</button>
      </div>
    );
  }
  return <CrewBoard data={data} state={state} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
    onOpen={onOpen} onReply={onReply} onShowThreads={onShowThreads} deskMenu={deskMenu} />;
}

/** The bot whose work sheet is open stays open while the drawer closes and opens again in this session. */
let rememberedSheet: string | null = null;
/** For tests: start each render with no sheet open. */
export function resetBotSheet(): void { rememberedSheet = null; }

function CrewBoard({ data, state, activeThreadId, isCompactViewport, now, onOpen, onReply, onShowThreads, deskMenu }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number;
  onOpen: (threadId: string) => void; onReply?: (threadId: string, text: string) => void; onShowThreads: () => void; deskMenu?: DeskMenu;
}) {
  const bots = useMemo(() => orderedBots(data), [data]);
  const layouts = useMemo(() => bots.map(bot => layoutBot(bot, now)), [bots, now]);
  const needs = useMemo(() => needRows(data), [data]);
  const botByKey = useMemo(() => new Map(bots.map(bot => [bot.key, bot])), [bots]);

  // A bot's work sheet, opened by a tap on its desk: its asks, all its work, its chat.
  const [sheetKey, setSheetKey] = useState<string | null>(() => rememberedSheet);
  const focus = sheetKey ? layouts.find(layout => layout.bot.key === sheetKey) ?? null : null;
  // A bot that leaves the roster closes its sheet for good, so it never reopens if the bot comes back.
  useEffect(() => { if (sheetKey && !focus) setSheetKey(null); }, [sheetKey, focus]);
  useEffect(() => { rememberedSheet = sheetKey; }, [sheetKey]);
  const bands = useMemo(() => feedBands(focus ? [focus] : layouts), [focus, layouts]);

  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds);
  useEffect(() => { writeStored(FOLDS_KEY, JSON.stringify(folds)); }, [folds]);
  const isOpen = (id: string, fallback: boolean) => folds[id] ?? fallback;
  const toggle = (id: string, fallback: boolean) => setFolds(previous => ({ ...previous, [id]: !(previous[id] ?? fallback) }));

  const [needsAll, setNeedsAll] = useState(() => readStored("radar-sidebar:bots-needs-all:v1", "off", ["off", "on"]) === "on");
  useEffect(() => { writeStored("radar-sidebar:bots-needs-all:v1", needsAll ? "on" : "off"); }, [needsAll]);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNeed = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNeed.current) return;
    const key = focusNeed.current;
    focusNeed.current = null;
    const rows = rootRef.current?.querySelectorAll<HTMLElement>("button[data-need-key]") ?? [];
    Array.from(rows).find(row => row.dataset.needKey === key)?.focus();
  });

  // One task's details open at a time: the panel is the row's own, so a second tap elsewhere moves it.
  const [infoTask, setInfoTask] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPeek = useCallback(() => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
    setPeek(null);
  }, []);
  useEffect(() => clearPeek, [clearPeek]);
  const canPeek = !isCompactViewport;

  const open = (threadId: string | null) => {
    if (!threadId) return;
    clearPeek();
    onOpen(threadId);
  };
  const answer = (threadId: string, text: string) => {
    clearPeek();
    if (onReply) onReply(threadId, text); else onOpen(threadId);
  };

  /* ---------- Needs you: each ask as a card, its question in full, its answers one tap away ---------- */
  // Every ask is on the page, so no bot's question hides behind its desk's bubble: with a sheet open, its
  // bot's asks lead the sheet and every other bot's stay listed under it.
  const ownAsks = focus ? needs.filter(need => need.botKey === focus.bot.key) : [];
  const asks = focus ? needs.filter(need => need.botKey !== focus.bot.key) : needs;
  const showAllNeeds = isCompactViewport || needsAll || asks.length <= NEEDS_SHOWN;
  const shownNeeds = showAllNeeds ? asks : asks.slice(0, NEEDS_SHOWN);
  const askCard = (need: NeedRow, inSheet = false) => {
    const bot = need.bot ?? { key: need.botKey, name: need.botKey, color: undefined, faceUrl: undefined };
    const name = shortBotName(bot.name);
    return (
      <li key={need.key} className="radar-ask">
        <button type="button" className="radar-ask-open" data-task-id={need.taskId} data-need-key={need.key}
          aria-current={activeThreadId !== null && need.threadId === activeThreadId ? "page" : undefined}
          aria-label={`${need.question}. ${name}${need.taskTitle ? `, ${need.taskTitle}` : ""}`}
          disabled={!need.threadId}
          onClick={() => open(need.threadId)}>
          <span className="radar-ask-face" aria-hidden="true"><BotTaskFace bot={bot} size={isCompactViewport ? 34 : 30} state="needs-you" /></span>
          <span className="radar-ask-who">
            {/* Inside its bot's sheet the name is the heading already; the card names only the task. */}
            {inSheet ? null : <span className="radar-ask-bot" dir="auto">{name}</span>}
            {need.taskTitle && !inSheet ? <span className="radar-sep" aria-hidden="true">·</span> : null}
            {need.taskTitle ? <bdi dir="auto" className="radar-ask-task">{need.taskTitle}</bdi> : null}
          </span>
          <bdi dir="auto" className="radar-ask-question">{need.question}</bdi>
        </button>
        {need.options.length > 0 && need.threadId ? (
          <div className="radar-ask-answers" role="group" aria-label={`Answers: ${need.question}`}>
            {need.options.map(option => (
              <button key={option} type="button" className="radar-ask-answer" data-answer={option}
                title="Opens the chat with this answer typed in. Nothing is sent."
                aria-label={`Answer ${option}: opens the chat with it typed in`}
                onClick={() => answer(need.threadId!, option)}>
                <bdi dir="auto" className="radar-ask-pill">{option}</bdi>
              </button>
            ))}
          </div>
        ) : null}
      </li>
    );
  };

  /* ---------- Now: live work grouped by what is happening ---------- */
  const feedTask = (bot: BotTasksBot, task: BotTaskRow, band: Band): ReactNode => {
    const target = task.conversationThreadId ?? bot.coordinatorThreadId;
    const age = rowAge(task, data.observedAt, now);
    const word = task.displayState === band.primary ? "" : rowStateWord(task, now);
    const detail = rowDetail(task, now);
    const label = STATE_LABEL[task.displayState] + (task.displayState === "waiting" && task.waitFor ? ` for ${task.waitFor}` : "");
    const infoOpen = infoTask === task.id;
    const infoId = `radar-task-info-${task.id}`;
    return (
      <li key={task.id} className={cn("radar-feed-item", infoOpen && "radar-feed-item-open")}>
        <div className={cn("radar-feed-rowline", `radar-feed-${task.displayState}`)}>
          <button type="button" className="radar-feed-row" data-task-id={task.id} data-state={task.displayState}
            // Only a task's own conversation marks it open: one without a worker opens the bot's chat.
            aria-current={activeThreadId !== null && task.conversationThreadId === activeThreadId ? "page" : undefined}
            aria-label={`${task.title || "Untitled task"}, ${shortBotName(bot.name)}, ${label}, ${age}${detail ? `. ${detail}` : ""}`}
            title={task.conversationThreadId ? undefined : `No task conversation yet: opens ${bot.name}`}
            onClick={() => open(target)}
            onMouseEnter={canPeek ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (peekTimer.current) clearTimeout(peekTimer.current);
              peekTimer.current = setTimeout(() => setPeek({ task, bot, age, top: rect.top, left: rect.right + 8 }), PEEK_DELAY_MS);
            } : undefined}
            onMouseLeave={canPeek ? clearPeek : undefined}>
            <BotTaskFace bot={bot} size={26} />
            <span className="radar-feed-body">
              <span className="radar-feed-titleline">
                <bdi dir="auto" className="radar-feed-title">{task.title || "Untitled task"}</bdi>
                {task.tags.includes("dev") ? <span className="radar-feed-chip">dev</span> : null}
              </span>
              <span className="radar-feed-line">
                {joined([
                  focus ? null : <span key="bot" className="radar-feed-bot">{shortBotName(bot.name)}</span>,
                  word ? <span key="word" className={cn("radar-feed-state", `radar-feed-state-${task.displayState}`)}>{word}</span> : null,
                  detail ? <bdi key="detail" dir="auto" className="radar-feed-detail">{detail}</bdi> : null,
                ])}
              </span>
            </span>
          </button>
          <button type="button" className="radar-feed-more" data-info-task={task.id}
            aria-expanded={infoOpen} aria-controls={infoOpen ? infoId : undefined}
            aria-label={`${infoOpen ? "Hide" : "Show"} details: ${task.title || "Untitled task"}`}
            onClick={() => { clearPeek(); setInfoTask(infoOpen ? null : task.id); }}>
            <span className="radar-feed-age" aria-hidden="true">{age}</span>
            <Icon name="ChevronDown" aria-hidden="true" className="radar-feed-more-icon" />
          </button>
        </div>
        {infoOpen ? <TaskInfo id={infoId} task={task} now={now} observedAt={data.observedAt} activeThreadId={activeThreadId} onOpen={open} /> : null}
      </li>
    );
  };

  const feedItem = (item: FeedItem, band: Band): ReactNode => {
    if (item.kind === "task") return feedTask(item.bot, item.task, band);
    return (
      <li key={item.threadId} className="radar-feed-item">
        <div className="radar-feed-rowline radar-feed-working">
          <button type="button" className="radar-feed-row radar-feed-unlinked" data-state="working"
            aria-current={item.threadId === activeThreadId ? "page" : undefined}
            aria-label={`${item.title || "Untitled worker"}, ${shortBotName(item.bot.name)}, running, no task`}
            onClick={() => open(item.threadId)}>
            <BotTaskFace bot={item.bot} size={26} />
            <span className="radar-feed-body">
              <bdi dir="auto" className="radar-feed-title">{item.title || "Untitled worker"}</bdi>
              <span className="radar-feed-line">
                {joined([
                  focus ? null : <span key="bot" className="radar-feed-bot">{shortBotName(item.bot.name)}</span>,
                  <span key="detail" className="radar-feed-detail">worker without a task</span>,
                ])}
              </span>
            </span>
          </button>
        </div>
      </li>
    );
  };

  const band = (item: Band) => {
    // In a bot's sheet its waits and today's work show open; across the crew they fold to a count.
    const fallback = ALWAYS_OPEN.has(item.key) || (focus !== null && (item.key === "waiting" || item.key === "done"));
    const foldId = `${focus ? focus.bot.key : FOLD_SCOPE}:${item.key}`;
    const foldable = !ALWAYS_OPEN.has(item.key);
    const shown = !foldable || isOpen(foldId, fallback);
    const halted = item.key === "done" ? item.items.filter(entry => entry.kind === "task" && entry.task.displayState !== "done").length : 0;
    const count = halted > 0 ? `${item.items.length - halted} · ${halted} stopped` : String(item.items.length);
    const head = (
      <>
        <span className={cn("radar-band-mark", `radar-band-mark-${item.tone}`)} aria-hidden="true" />
        <span className="radar-band-label">{item.label}</span>
        <span className="radar-band-count">{count}</span>
      </>
    );
    return (
      <section key={item.key} className={cn("radar-band", `radar-band-${item.key}`)} aria-label={item.label} data-band={item.key}>
        {foldable ? (
          <button type="button" className="radar-band-head radar-band-toggle" data-fold={item.key} aria-expanded={shown} onClick={() => toggle(foldId, fallback)}>
            {head}
            <Chevron open={shown} />
          </button>
        ) : <h4 className="radar-band-head">{head}</h4>}
        {shown ? <ul className="radar-feed-list">{item.items.map(entry => feedItem(entry, item))}</ul> : null}
      </section>
    );
  };

  const live = bands.filter(item => ALWAYS_OPEN.has(item.key));
  const liveCount = live.reduce((sum, item) => sum + item.items.length, 0);
  // The whiteboard counts the whole crew.
  const stuckCount = layouts.filter(layout => crewStatus(layout).tone === "trouble").length;
  const liveAll = layouts.reduce((sum, layout) => sum + layout.active.length + layout.bot.unlinked.length, 0);
  const notFiledOpen = isOpen("@not-filed", false);
  const stale = state.status === "error" || state.cached;

  return (
    <div ref={rootRef} className="radar-tasks" data-compact={isCompactViewport ? "true" : undefined}>
      {stale ? (
        <p className="radar-tasks-stale" role="status">
          {`As of ${asOf(data.observedAt, now)}. ${state.status === "error" ? "Retrying." : "Updating…"}`}
        </p>
      ) : null}

      <section className="radar-studio" aria-label="Bots">
        {layouts.length === 0 ? <p className="radar-bots-empty">No bots are registered.</p> : (
          <div className="radar-room">
            <span className="radar-room-window" aria-hidden="true"><span /><span /></span>
            {/* The day's counts on the studio's whiteboard: what needs Salem, what is stuck, what is moving. */}
            <p className="radar-room-board">
              {needs.length > 0 ? <span className="radar-room-board-ask">{`${needs.length} ${needs.length === 1 ? "ask" : "asks"}`}</span> : null}
              {stuckCount > 0 ? <span className="radar-room-board-trouble">{`${stuckCount} stuck`}</span> : null}
              <span>{liveAll > 0 ? `${liveAll} live` : needs.length + stuckCount > 0 ? "" : "All quiet"}</span>
            </p>
            <ul className="radar-room-floor">
              {layouts.map(layout => (
                <Desk key={layout.bot.key} layout={layout} compact={isCompactViewport} Menu={deskMenu}
                  sheetOpen={focus?.bot.key === layout.bot.key}
                  chatOpen={activeThreadId === layout.bot.coordinatorThreadId}
                  onOpenChat={() => open(layout.bot.coordinatorThreadId)}
                  onShowWork={() => { clearPeek(); setInfoTask(null); setSheetKey(key => key === layout.bot.key ? null : layout.bot.key); }} />
              ))}
            </ul>
          </div>
        )}
        {layouts.length > 0 && deskMenu ? (
          <p className="radar-room-hint">
            <span className="radar-room-hint-mouse">Click a bot to chat, its name for its work · right-click for more</span>
            <span className="radar-room-hint-touch">Tap a bot to chat, its name for its work · hold for more</span>
          </p>
        ) : null}
      </section>

      {focus ? (
        // The bot's work sheet opens right under the room, its notch pointing at the bot's desk.
        <section id={BOT_SHEET_ID} className="radar-sheet" aria-label={`${focus.bot.name}: work`} data-column={layouts.indexOf(focus) % 3}
          style={{ "--radar-bot": botTint(focus.bot) } as CSSProperties}>
          <div className="radar-section-head radar-focus-head">
            <BotTaskFace bot={focus.bot} size={26} state={moodFace(focus.mood)} />
            <h3 dir="auto">{`${shortBotName(focus.bot.name)}'s work`}</h3>
            <button type="button" className="radar-focus-chat"
              aria-current={activeThreadId === focus.bot.coordinatorThreadId ? "page" : undefined}
              aria-label={`Chat with ${shortBotName(focus.bot.name)}`}
              onClick={() => open(focus.bot.coordinatorThreadId)}>
              <Icon name="MessageSquare" aria-hidden="true" className="radar-focus-chat-icon" />Chat
            </button>
            <button type="button" className="radar-focus-clear" aria-label={`Close ${shortBotName(focus.bot.name)}'s work`} onClick={() => { setInfoTask(null); setSheetKey(null); }}>
              <Icon name="X" aria-hidden="true" className="radar-focus-clear-icon" />
            </button>
          </div>
          {ownAsks.length > 0 ? (
            <section className="radar-asks radar-asks-own" aria-label={`${focus.bot.name}: needs you`}>
              <ul className="radar-ask-list">{ownAsks.map(need => askCard(need, true))}</ul>
            </section>
          ) : null}
          {liveCount === 0 && ownAsks.length === 0 ? <p className="radar-bots-empty">{focus.quiet ? "Nothing open. Resting." : "Nothing running."}</p> : null}
          {bands.map(band)}
        </section>
      ) : null}

      {focus && asks.length === 0 ? null : (
      <section className={cn("radar-asks", asks.length === 0 && "radar-asks-clear")} aria-label={focus ? "Other bots need you" : "Needs you"}>
        {asks.length === 0 ? (
          <p className="radar-asks-none"><Icon name="Check" aria-hidden="true" className="radar-asks-none-icon" />Nothing needs you</p>
        ) : (
          <>
            <div className="radar-section-head">
              <h3>{focus ? "Other bots need you" : "Needs you"}</h3>
              <span className="radar-section-count">{asks.length}</span>
            </div>
            <ul className="radar-ask-list">
              {shownNeeds.map(need => askCard(need))}
            </ul>
            {!showAllNeeds ? (
              <button type="button" className="radar-more" aria-expanded={false} onClick={() => {
                // The pressed button unmounts: focus moves to the first ask it revealed.
                focusNeed.current = asks[NEEDS_SHOWN]?.key ?? null;
                setNeedsAll(true);
              }}>{`${asks.length - NEEDS_SHOWN} more ${asks.length - NEEDS_SHOWN === 1 ? "ask" : "asks"}`}</button>
            ) : needsAll && !isCompactViewport && asks.length > NEEDS_SHOWN ? (
              <button type="button" className="radar-more" aria-expanded onClick={() => setNeedsAll(false)}>Show fewer</button>
            ) : null}
          </>
        )}
      </section>
      )}

      {!focus && layouts.length > 0 ? (
        <section className="radar-now" aria-label="Now">
          <div className="radar-section-head">
            <h3>Now</h3>
            <span className="radar-section-count">{liveCount > 0 ? liveCount : ""}</span>
          </div>
          {liveCount === 0 ? <p className="radar-bots-empty">Nothing running right now.</p> : null}
          {bands.map(band)}
        </section>
      ) : null}

      {!focus && data.notFiled.length > 0 ? (
        <section className="radar-notfiled" aria-label="Not filed">
          <button type="button" className="radar-band-head radar-band-toggle" aria-expanded={notFiledOpen} onClick={() => toggle("@not-filed", false)}>
            <span className="radar-band-mark radar-band-mark-quiet" aria-hidden="true" />
            <span className="radar-band-label">Not filed</span>
            <span className="radar-band-count">{data.notFiled.length}</span>
            <Chevron open={notFiledOpen} />
          </button>
          {notFiledOpen ? (
            <ul className="radar-feed-list">
              {data.notFiled.slice(0, NOT_FILED_SHOWN).map(item => {
                const suggested = item.suggestedBot ? botByKey.get(item.suggestedBot) : undefined;
                return (
                  <li key={item.threadId} className="radar-feed-item">
                    <div className="radar-feed-rowline">
                      <button type="button" className="radar-feed-row radar-feed-notfiled"
                        aria-current={item.threadId === activeThreadId ? "page" : undefined}
                        onClick={() => open(item.threadId)}>
                        <span className="radar-task-glyph radar-task-glyph-plain" aria-hidden="true" />
                        <span className="radar-feed-body">
                          <bdi dir="auto" className="radar-feed-title">{item.title || "Untitled thread"}</bdi>
                          <span className="radar-feed-line">{suggested ? `Likely ${shortBotName(suggested.name)}` : "No bot"}</span>
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
              {data.notFiled.length > NOT_FILED_SHOWN ? (
                <li><button type="button" className="radar-more" onClick={onShowThreads}>
                  {data.notFiled.length - NOT_FILED_SHOWN} more in Threads
                </button></li>
              ) : null}
            </ul>
          ) : null}
        </section>
      ) : null}

      {peek && typeof document !== "undefined" ? createPortal(
        <div className="radar-task-peek" role="tooltip" style={{ top: Math.max(8, Math.min(peek.top, window.innerHeight - 180)), left: Math.min(peek.left, window.innerWidth - 300) }}>
          <bdi dir="auto" className="radar-task-peek-title">{peek.task.title || "Untitled task"}</bdi>
          <span className="radar-task-peek-meta">
            {shortBotName(peek.bot.name)} · {STATE_LABEL[peek.task.displayState]}{peek.task.waitFor ? `: ${peek.task.waitFor}` : ""} · {peek.age}
          </span>
          {peek.task.line ? <bdi dir="auto" className="radar-task-peek-line">{localizeDoneLine(peek.task, now)}</bdi> : null}
          {peek.task.needs ? <bdi dir="auto" className="radar-task-peek-line">Asks: {peek.task.needs.question}</bdi> : null}
          {peek.task.origin !== "verified" ? <span className="radar-task-peek-meta">{peek.task.origin === "imported" ? "Filed from history" : "Not confirmed as yours: filed only"}</span> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
