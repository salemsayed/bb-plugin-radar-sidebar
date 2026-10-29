import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  MOOD_TONE,
  STATE_LABEL,
  isClosed,
  isSameLocalDay,
  layoutBot,
  localizeDoneLine,
  needRows,
  orderedBots,
  rowStartedAt,
  shortModel,
  type Attempt,
  type BotLayout,
  type BotMood,
  type BotTaskRow,
  type BotTasksBot,
  type BotTasksData,
  type NeedRow,
} from "@/lib/botTasks";
import { botStyle, shortBotName, type BotState } from "./bots";
import { BotFace } from "./BotFace";
import { shortAgo } from "./time";
import type { BotTasksState } from "./useBotTasks";
import { useTaskAttempts } from "./useTaskAttempts";
import { readStored, writeStored } from "./useListSettings";

/** Needs rows shown on a desktop before "See all"; a phone always shows every decision. */
export const NEEDS_SHOWN = 3;
/** Not filed rows rendered before the rest are left to the Threads list. */
const NOT_FILED_SHOWN = 30;
const FOLDS_KEY = "radar-sidebar:bots-folds:v1";
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

function StateGlyph({ state }: { state: BotTaskRow["displayState"] }) {
  return <span className={cn("radar-task-glyph", `radar-task-glyph-${state}`)} aria-hidden="true" />;
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
 * The bot as the hero of its card: a large face in its mood, with a ring
 * that turns while it works, a "?" when it needs Salem and a "!" when
 * something is overdue or offline. Decorative: the header's label says it all.
 */
function BotHero({ bot, mood, size }: { bot: BotTasksBot; mood: BotMood; size: number }) {
  const badge = mood === "needs" ? "?" : mood === "overdue" || mood === "offline" ? "!" : null;
  return (
    <span className={cn("radar-tasks-hero", `radar-tasks-hero-${MOOD_TONE[mood]}`)} data-mood={mood} aria-hidden="true">
      <span className="radar-tasks-hero-ring" />
      <BotTaskFace bot={bot} size={size} state={moodFace(mood)} />
      {badge ? <span className="radar-tasks-hero-badge">{badge}</span> : null}
    </span>
  );
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

function rowLine(task: BotTaskRow, now: number): string {
  if (task.displayState === "waiting") return waitingLine(task);
  return localizeDoneLine(task, now) || task.needs?.question || STATE_LABEL[task.displayState];
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

/**
 * The Bots view of the sidebar: Needs you across every bot, then each bot in
 * roster order with its tasks, then work no task owns. Every row opens bb's
 * own thread route; nothing here changes a task.
 */
export function BotsView({
  state,
  activeThreadId,
  isCompactViewport,
  now,
  onOpen,
  onShowThreads,
}: {
  state: BotTasksState;
  activeThreadId: string | null;
  isCompactViewport: boolean;
  now: number;
  onOpen: (threadId: string) => void;
  onShowThreads: () => void;
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
  return <BotsList data={data} state={state} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now} onOpen={onOpen} onShowThreads={onShowThreads} />;
}

function BotsList({ data, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number;
  onOpen: (threadId: string) => void; onShowThreads: () => void;
}) {
  const bots = useMemo(() => orderedBots(data), [data]);
  const layouts = useMemo(() => bots.map(bot => layoutBot(bot, now)), [bots, now]);
  const needs = useMemo(() => needRows(data), [data]);
  const botByKey = useMemo(() => new Map(bots.map(bot => [bot.key, bot])), [bots]);

  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds);
  useEffect(() => { writeStored(FOLDS_KEY, JSON.stringify(folds)); }, [folds]);
  const isOpen = (id: string, fallback: boolean) => folds[id] ?? fallback;
  const toggle = (id: string, fallback: boolean) => setFolds(previous => ({ ...previous, [id]: !(previous[id] ?? fallback) }));

  const [needsAll, setNeedsAll] = useState(() => readStored("radar-sidebar:bots-needs-all:v1", "off", ["off", "on"]) === "on");
  useEffect(() => { writeStored("radar-sidebar:bots-needs-all:v1", needsAll ? "on" : "off"); }, [needsAll]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNeed = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNeed.current) return;
    const key = focusNeed.current;
    focusNeed.current = null;
    const rows = rootRef.current?.querySelectorAll<HTMLElement>("[data-need-key]") ?? [];
    Array.from(rows).find(row => row.dataset.needKey === key)?.focus();
  });
  const toggleExpanded = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
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

  const taskRow = (bot: BotTasksBot, task: BotTaskRow): ReactNode => {
    const target = task.conversationThreadId ?? bot.coordinatorThreadId;
    const age = rowAge(task, data.observedAt, now);
    const label = STATE_LABEL[task.displayState] + (task.displayState === "waiting" && task.waitFor ? ` for ${task.waitFor}` : "");
    const detail = rowDetail(task, now);
    const infoOpen = infoTask === task.id;
    const infoId = `radar-task-info-${task.id}`;
    return (
      <li key={task.id} className={cn("radar-task-item", infoOpen && "radar-task-item-open")}>
        {/* The row line wears the state's wash; the row opens the latest attempt, the end column (age, then the details toggle) opens the details. */}
        <div className={cn("radar-task-rowline", `radar-task-${task.displayState}`)}>
        <button
          type="button"
          className={cn("radar-task-row", `radar-task-${task.displayState}`)}
          data-task-id={task.id}
          // Only a task's own conversation marks it open: one without a worker opens the bot's chat, which is the card's.
          aria-current={activeThreadId !== null && task.conversationThreadId === activeThreadId ? "page" : undefined}
          aria-label={`${task.title || "Untitled task"}, ${label}, ${age}${rowLine(task, now) !== label ? `. ${rowLine(task, now)}` : ""}`}
          title={task.conversationThreadId ? undefined : `No task conversation yet: opens ${bot.name}`}
          onClick={() => open(target)}
          onMouseEnter={canPeek ? (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (peekTimer.current) clearTimeout(peekTimer.current);
            peekTimer.current = setTimeout(() => setPeek({ task, bot, age, top: rect.top, left: rect.right + 8 }), PEEK_DELAY_MS);
          } : undefined}
          onMouseLeave={canPeek ? clearPeek : undefined}
        >
          <StateGlyph state={task.displayState} />
          <span className="radar-task-body">
            <span className="radar-task-titleline">
              <bdi dir="auto" className="radar-task-title">{task.title || "Untitled task"}</bdi>
              {task.tags.includes("dev") ? <span className="radar-task-chip">dev</span> : null}
            </span>
            <span className="radar-task-line">
              <span className={cn("radar-task-state", `radar-task-state-${task.displayState}`)}>{rowStateWord(task, now)}</span>
              {detail ? <bdi dir="auto" className="radar-task-detail">{detail}</bdi> : null}
            </span>
          </span>
        </button>
        <button type="button" className="radar-task-info-toggle" data-info-task={task.id}
          aria-expanded={infoOpen} aria-controls={infoOpen ? infoId : undefined}
          aria-label={`${infoOpen ? "Hide" : "Show"} details: ${task.title || "Untitled task"}`}
          onClick={() => { clearPeek(); setInfoTask(infoOpen ? null : task.id); }}>
          <span className="radar-task-age" aria-hidden="true">{age}</span>
          <Icon name="Info" aria-hidden="true" className="radar-task-info-icon" />
        </button>
        </div>
        {infoOpen ? <TaskInfo id={infoId} task={task} now={now} observedAt={data.observedAt} activeThreadId={activeThreadId} onOpen={open} /> : null}
      </li>
    );
  };

  const foldRow = (id: string, text: string, isExpanded: boolean, onToggle: () => void, kind?: string) => (
    <li key={id}>
      <button type="button" className="radar-task-fold" data-fold={kind} aria-expanded={isExpanded} onClick={onToggle}>
        <span className="radar-task-fold-chevron" aria-hidden="true"><Chevron open={isExpanded} /></span>
        <span className="radar-task-fold-text">{text}</span>
      </button>
    </li>
  );

  const botGroup = (layout: BotLayout) => {
    const { bot } = layout;
    const groupOpen = isOpen(bot.key, !layout.quiet);
    const waitingOpen = expanded.has(`${bot.key}:waiting`);
    const doneOpen = expanded.has(`${bot.key}:done`);
    const weekOpen = expanded.has(`${bot.key}:week`);
    const done = layout.closedToday.filter(task => task.displayState === "done").length;
    const halted = layout.closedToday.length - done;
    // "today" once: "Done today · 2 · 1 stopped", or "1 stopped today" alone.
    const doneLabel = [done > 0 ? `Done today · ${done}` : null, halted > 0 ? `${halted} stopped${done > 0 ? "" : " today"}` : null].filter(Boolean).join(" · ");
    const tone = MOOD_TONE[layout.mood];
    return (
      <section key={bot.key}
        className={cn("radar-tasks-bot", `radar-tasks-bot-${tone}`, layout.quiet && "radar-tasks-bot-quiet", !groupOpen && "radar-tasks-bot-folded")}
        data-mood={layout.mood} data-bot={bot.key} aria-label={bot.name}>
        <div className="radar-tasks-bot-head">
          <button type="button" className="radar-tasks-bot-open"
            aria-current={activeThreadId === bot.coordinatorThreadId ? "page" : undefined}
            aria-label={`Open ${bot.name}: ${layout.summary}`}
            onClick={() => open(bot.coordinatorThreadId)}>
            {/* A quiet bot has nothing to show: a smaller face keeps its card to one compact header. */}
            <BotHero bot={bot} mood={layout.mood} size={layout.quiet ? 28 : isCompactViewport ? 44 : 40} />
            <span className="radar-tasks-bot-text">
              <span className="radar-tasks-bot-name" dir="auto">{shortBotName(bot.name)}</span>
              {/* The first part is the bot's mood and wears its tone; the rest are counts. Parts wrap onto a hidden
                  second line, so a narrow header drops whole parts, never half a word. */}
              <span className="radar-tasks-bot-summary" aria-hidden="true">
                {layout.summaryParts.map((part, index) => (
                  <span key={part} className={cn("radar-tasks-bot-summary-part", index === 0 && "radar-tasks-bot-mood")}>{part}</span>
                ))}
              </span>
            </span>
          </button>
          <button type="button" className="radar-tasks-chevron" aria-expanded={groupOpen}
            aria-label={`${groupOpen ? "Fold" : "Unfold"} ${bot.name}`} onClick={() => toggle(bot.key, !layout.quiet)}>
            <Chevron open={groupOpen} />
          </button>
        </div>
        {groupOpen ? (
          <ul className="radar-task-list">
            {layout.needs.map(task => taskRow(bot, task))}
            {layout.active.map(task => taskRow(bot, task))}
            {bot.unlinked.map(item => (
              <li key={item.threadId}>
                <button type="button" className="radar-task-row radar-task-working radar-task-unlinked"
                  aria-current={item.threadId === activeThreadId ? "page" : undefined}
                  aria-label={`${item.title || "Untitled worker"}, running, no task`}
                  onClick={() => open(item.threadId)}>
                  <StateGlyph state="working" />
                  <span className="radar-task-body">
                    <bdi dir="auto" className="radar-task-title">{item.title || "Untitled worker"}</bdi>
                    <span className="radar-task-line">
                      <span className="radar-task-state radar-task-state-working">Running</span>
                      <span className="radar-task-detail">no task</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {layout.waitingShown.map(task => taskRow(bot, task))}
            {layout.waitingFolded.length > 0
              ? foldRow(`${bot.key}:waiting`, waitingOpen ? "Fewer waiting" : `${layout.waitingFolded.length} more waiting`, waitingOpen, () => toggleExpanded(`${bot.key}:waiting`), "waiting")
              : null}
            {waitingOpen ? layout.waitingFolded.map(task => taskRow(bot, task)) : null}
            {layout.closedToday.length > 0
              ? foldRow(`${bot.key}:done`, doneLabel, doneOpen, () => toggleExpanded(`${bot.key}:done`), "done")
              : null}
            {doneOpen ? layout.closedToday.map(task => taskRow(bot, task)) : null}
            {/* The week of closed work the core sends stays under its bot, folded: nothing finished vanishes (Salem, thr_g9gsfjxfyx). */}
            {layout.closedEarlier.length > 0
              ? foldRow(`${bot.key}:week`, `Earlier this week · ${layout.closedEarlier.length}`, weekOpen, () => toggleExpanded(`${bot.key}:week`), "week")
              : null}
            {weekOpen ? layout.closedEarlier.map(task => taskRow(bot, task)) : null}
            {layout.quiet && layout.closedToday.length === 0 && layout.closedEarlier.length === 0 ? <li className="radar-task-empty">Nothing open</li> : null}
          </ul>
        ) : null}
      </section>
    );
  };

  // A phone shows every decision, so any one is two taps from anywhere: the drawer, then the row.
  const showAllNeeds = isCompactViewport || needsAll || needs.length <= NEEDS_SHOWN;
  const shownNeeds = showAllNeeds ? needs : needs.slice(0, NEEDS_SHOWN);
  const needRow = (need: NeedRow) => {
    const bot = need.bot ?? { key: need.botKey, name: need.botKey, color: undefined, faceUrl: undefined };
    const where = [shortBotName(bot.name), need.taskTitle].filter(Boolean).join(" · ");
    return (
      <li key={need.key}>
        <button type="button" className="radar-need-row" data-task-id={need.taskId} data-need-key={need.key}
          aria-current={activeThreadId !== null && need.threadId === activeThreadId ? "page" : undefined}
          disabled={!need.threadId}
          onClick={() => open(need.threadId)}>
          <BotTaskFace bot={bot} size={28} state="needs-you" />
          <span className="radar-task-body">
            <bdi dir="auto" className="radar-task-title">{need.question}</bdi>
            <bdi dir="auto" className="radar-task-line">{where}</bdi>
          </span>
        </button>
      </li>
    );
  };

  const notFiledOpen = isOpen("@not-filed", false);
  const stale = state.status === "error" || state.cached;

  return (
    <div ref={rootRef} className="radar-tasks" data-compact={isCompactViewport ? "true" : undefined}>
      {stale ? (
        <p className="radar-tasks-stale" role="status">
          {`As of ${asOf(data.observedAt, now)}. ${state.status === "error" ? "Retrying." : "Updating…"}`}
        </p>
      ) : null}

      <section className="radar-tasks-needs" aria-label="Needs you">
        <div className="radar-tasks-section-head">
          <h3>Needs you</h3>
          {needs.length > NEEDS_SHOWN && !isCompactViewport ? (
            <button type="button" className="radar-tasks-count" aria-expanded={showAllNeeds}
              aria-label={showAllNeeds ? `Needs you: ${needs.length}, show fewer` : `Needs you: open all ${needs.length}`}
              onClick={() => setNeedsAll(value => !value)}>
              {needs.length}{showAllNeeds ? "" : " · open all"}
            </button>
          ) : <span className={cn("radar-tasks-count-static", needs.length === 0 && "radar-tasks-count-zero")}>{needs.length}</span>}
        </div>
        {needs.length === 0 ? <p className="radar-task-empty">Nothing needs you.</p> : (
          <ul className="radar-task-list">
            {shownNeeds.map(needRow)}
            {!showAllNeeds ? foldRow("@needs", `See all ${needs.length}`, false, () => {
              // The pressed row unmounts: focus moves to the first decision it revealed.
              focusNeed.current = needs[NEEDS_SHOWN]?.key ?? null;
              setNeedsAll(true);
            }) : null}
          </ul>
        )}
      </section>

      <div className="radar-tasks-section-head"><h3>Bots</h3></div>
      {layouts.length === 0 ? <p className="radar-task-empty">No bots are registered.</p> : layouts.map(botGroup)}

      {/* Work a bot runs without a task now shows inside its bot's group (Salem, 2026-10-29). */}

      <section className="radar-tasks-extra" aria-label="Not filed">
        <button type="button" className="radar-tasks-section-toggle" aria-expanded={notFiledOpen}
          onClick={() => toggle("@not-filed", false)}>
          <span className="radar-tasks-section-toggle-label">Not filed</span>
          <span className="radar-tasks-section-count">{data.notFiled.length}</span>
          <Chevron open={notFiledOpen} />
        </button>
        {notFiledOpen ? (
          data.notFiled.length === 0 ? <p className="radar-task-empty">Every thread belongs to a bot.</p> : (
            <ul className="radar-task-list">
              {data.notFiled.slice(0, NOT_FILED_SHOWN).map(item => {
                const suggested = item.suggestedBot ? botByKey.get(item.suggestedBot) : undefined;
                return (
                  <li key={item.threadId}>
                    <button type="button" className="radar-task-row radar-task-notfiled"
                      aria-current={item.threadId === activeThreadId ? "page" : undefined}
                      onClick={() => open(item.threadId)}>
                      <span className="radar-task-glyph radar-task-glyph-plain" aria-hidden="true" />
                      <span className="radar-task-body">
                        <bdi dir="auto" className="radar-task-title">{item.title || "Untitled thread"}</bdi>
                        <span className="radar-task-line">{suggested ? `Likely ${shortBotName(suggested.name)}` : "No bot"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {data.notFiled.length > NOT_FILED_SHOWN ? (
                <li><button type="button" className="radar-task-fold" onClick={onShowThreads}>
                  {data.notFiled.length - NOT_FILED_SHOWN} more in Threads
                </button></li>
              ) : null}
            </ul>
          )
        ) : null}
      </section>

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
