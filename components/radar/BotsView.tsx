import {
  STATE_LABEL,
  isClosed,
  isSameLocalDay,
  localizeDoneLine,
  type BotMood,
  type BotTaskRow,
  type BotTasksBot,
} from "@/lib/botTasks";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BotFace } from "./BotFace";
import { botStyle, shortBotName, type BotState } from "./bots";
import { DispatchBoard } from "./DispatchBoard";
import { StageFace } from "./StageFace";
import { Icon } from "@/components/ui/icon";
import { cachedRoster } from "./useBotRoster";
import type { BotTasksState } from "./useBotTasks";

// 24-hour, like the waiting rows' "tonight 20:30" (a finished row read "5:54 PM" next to them).
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A copy from an earlier day says which day, so yesterday's tasks never read as current. */
export function asOf(observedAt: number, now: number): string {
  return (isSameLocalDay(observedAt, now) ? timeFormatter : dateTimeFormatter).format(new Date(observedAt));
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

export const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const clearsWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
export const dayMonthFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
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
  onShowWork?: () => void;
}
export type DeskMenu = (props: DeskMenuProps) => ReactNode;

/** Opens a desk's menu the way a right-click would, at a point on screen. */
export function openMenuAt(element: Element, x?: number, y?: number): void {
  const box = element.getBoundingClientRect();
  x ??= box.left + box.width / 2;
  y ??= box.top + box.height / 2;
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
}

/** After a held touch lifts, clicks are swallowed this long, or until the next touch comes down. */
const SWALLOW_AFTER_LIFT_MS = 600;

let dropLiftGuard: (() => void) | null = null;

function guardLift(): void {
  dropLiftGuard?.();
  const swallow = (event: MouseEvent) => {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    drop();
  };
  const still = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const drop = () => {
    document.removeEventListener("click", swallow, true);
    document.removeEventListener("mousedown", still, true);
    document.removeEventListener("mouseup", still, true);
    document.removeEventListener("pointerdown", drop, true);
    if (dropLiftGuard === drop) dropLiftGuard = null;
  };
  document.addEventListener("mousedown", still, true);
  document.addEventListener("mouseup", still, true);
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerdown", drop, true);
  dropLiftGuard = drop;
}

/**
 * The desk's press handling, on the element that holds both of its buttons: a held touch opens the menu and
 * the clicks the browser sends when that touch lifts are swallowed before either button sees them (Chromium
 * sends one, iOS may), so neither the chat nor the sheet opens under the menu (Salem, thr_2gjivwx8ea seq
 * 2358). The next touch starts fresh. A touch that moves is a scroll and does nothing. Taps go through to
 * whichever button was tapped.
 */
export function useDeskPress() {
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
        guardLift();
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
        guardLift();
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

const SKELETON_ROWS = 7;

function BoardSkeleton() {
  const roster = cachedRoster();
  const rows = roster.length ? roster.map(bot => ({ key: bot.key, name: bot.name })) : Array.from({ length: SKELETON_ROWS }, (_, i) => ({ key: `row-${i}`, name: "" }));
  return <div className="stage stage-skeleton" aria-busy="true">
    <div className="stage-needs-slot">
      <section className="stage-needs" data-state="checking" data-slim="" aria-label="Needs you: checking">
        <h2 className="stage-needs-title stage-needs-line"><Icon name="Clock" aria-hidden="true" className="stage-needs-line-icon" /><span className="stage-needs-line-text" role="status">Checking for new questions…</span></h2>
      </section>
    </div>
    <div className="stage-bots-head" aria-hidden="true"><span>Bots</span><span>Last reply</span></div>
    <div className="stage-bots" aria-hidden="true">
      {rows.map(row => <div className="stage-row" data-skeleton="" key={row.key}><div className="stage-chat">
        <span className="stage-figure">{row.name ? <StageFace botKey={row.key} name={row.name} pose="idle" bare /> : <span className="stage-skel-face" />}</span>
        <span className="stage-copy">
          <span className="stage-head">{row.name ? <b>{row.name}</b> : <span className="stage-skel-bar" data-w="name" />}</span>
          <span className="stage-skel-bar" data-w="line" />
        </span>
      </div></div>)}
    </div>
  </div>;
}

export function BotsView({
  state,
  activeThreadId,
  isCompactViewport,
  now,
  onOpen,
  onShowThreads,
  deskMenu,
  unreadChats,
}: {
  state: BotTasksState;
  activeThreadId: string | null;
  isCompactViewport: boolean;
  now: number;
  onOpen: (threadId: string, messageSeq?: number) => void;
  onShowThreads: () => void;
  /** The bot menu each desk wears (long-press, right-click, or its "⋯"); the plugin passes bb's thread menu. */
  deskMenu?: DeskMenu;
  unreadChats?: ReadonlySet<string>;
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
  if (!data && status === "error") {
    return (
      <div className="radar-tasks-fallback" role="status">
        <p>Bot tasks didn't load. Retrying automatically.</p>
        <button type="button" className="radar-tasks-fallback-action" onClick={onShowThreads}>Show threads</button>
      </div>
    );
  }
  if (!data) return <BoardSkeleton />;
  return <DispatchBoard data={data} state={state} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
    onOpen={onOpen} onShowThreads={onShowThreads} deskMenu={deskMenu} unreadChats={unreadChats} />;
}
