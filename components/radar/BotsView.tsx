import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  STATE_LABEL,
  isSameLocalDay,
  layoutBot,
  needRows,
  orderedBots,
  rowStartedAt,
  type BotLayout,
  type BotTaskRow,
  type BotTasksBot,
  type BotTasksData,
  type NeedRow,
} from "@/lib/botTasks";
import { botStyle, shortBotName } from "./bots";
import { BotFace } from "./BotFace";
import { shortAgo } from "./time";
import type { BotTasksState } from "./useBotTasks";
import { readStored, writeStored } from "./useListSettings";

/** Needs rows shown on a desktop before "See all"; a phone always shows every decision. */
export const NEEDS_SHOWN = 3;
/** Not filed rows rendered before the rest are left to the Threads list. */
const NOT_FILED_SHOWN = 30;
const FOLDS_KEY = "radar-sidebar:bots-folds:v1";
const PEEK_DELAY_MS = 350;

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

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
export function BotTaskFace({ bot, size = 20 }: { bot: Pick<BotTasksBot, "key" | "name" | "color" | "faceUrl">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (bot.faceUrl && !broken) {
    return <img className="radar-tasks-face" src={bot.faceUrl} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
  }
  const style = botStyle(bot.key, bot.name);
  if (style.mascot) return <span className="radar-tasks-face" style={{ width: size, height: size }}><BotFace botKey={bot.key} name={bot.name} size={size} /></span>;
  return (
    <span className="radar-tasks-face radar-tasks-face-letter" style={{ width: size, height: size, background: bot.color ?? `hsl(${style.hue} 55% 45%)` }}>
      {shortBotName(bot.name).slice(0, 1).toUpperCase()}
    </span>
  );
}

function StateGlyph({ state }: { state: BotTaskRow["displayState"] }) {
  return <span className={cn("radar-task-glyph", `radar-task-glyph-${state}`)} aria-hidden="true" />;
}

function rowLine(task: BotTaskRow): string {
  if (task.displayState === "waiting" && task.waitFor) return `Waiting for ${task.waitFor}`;
  return task.line || task.needs?.question || STATE_LABEL[task.displayState];
}

function rowAge(task: BotTaskRow, observedAt: number, now: number): string {
  if (task.completedAt !== undefined && (task.displayState === "done" || task.displayState === "stopped" || task.displayState === "cancelled")) {
    return timeFormatter.format(new Date(task.completedAt));
  }
  return shortAgo(rowStartedAt(task, observedAt), now);
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
  const unlinked = useMemo(() => bots.flatMap(bot => bot.unlinked.map(item => ({ ...item, bot }))), [bots]);
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
    return (
      <li key={task.id}>
        <button
          type="button"
          className={cn("radar-task-row", `radar-task-${task.displayState}`)}
          data-task-id={task.id}
          aria-current={activeThreadId !== null && target === activeThreadId ? "page" : undefined}
          aria-label={`${task.title || "Untitled task"}, ${label}, ${age}${rowLine(task) !== label ? `. ${rowLine(task)}` : ""}`}
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
            <bdi dir="auto" className="radar-task-line">{rowLine(task)}</bdi>
          </span>
          <span className="radar-task-age">{age}</span>
        </button>
      </li>
    );
  };

  const foldRow = (id: string, text: string, isExpanded: boolean, onToggle: () => void) => (
    <li key={id}>
      <button type="button" className="radar-task-fold" aria-expanded={isExpanded} onClick={onToggle}>
        <span className="radar-task-fold-chevron" aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
        <span className="radar-task-fold-text">{text}</span>
      </button>
    </li>
  );

  const botGroup = (layout: BotLayout) => {
    const { bot } = layout;
    const groupOpen = isOpen(bot.key, !layout.quiet);
    const waitingOpen = expanded.has(`${bot.key}:waiting`);
    const doneOpen = expanded.has(`${bot.key}:done`);
    const done = layout.closedToday.filter(task => task.displayState === "done").length;
    const halted = layout.closedToday.length - done;
    const doneLabel = [done > 0 ? `Done today · ${done}` : null, halted > 0 ? `${halted} stopped today` : null].filter(Boolean).join(" · ");
    return (
      <section key={bot.key} className={cn("radar-tasks-bot", layout.quiet && "radar-tasks-bot-quiet")} aria-label={bot.name}>
        <div className="radar-tasks-bot-head">
          <button type="button" className="radar-tasks-chevron" aria-expanded={groupOpen}
            aria-label={`${groupOpen ? "Fold" : "Unfold"} ${bot.name}`} onClick={() => toggle(bot.key, !layout.quiet)}>
            <span aria-hidden="true">{groupOpen ? "▾" : "▸"}</span>
          </button>
          <button type="button" className="radar-tasks-bot-open"
            aria-current={activeThreadId === bot.coordinatorThreadId ? "page" : undefined}
            aria-label={`Open ${bot.name}: ${layout.summary}`}
            onClick={() => open(bot.coordinatorThreadId)}>
            <BotTaskFace bot={bot} />
            <span className="radar-tasks-bot-name" dir="auto">{shortBotName(bot.name)}</span>
            {/* Parts wrap onto a hidden second line, so a narrow header drops whole parts, never half a word. */}
            <span className="radar-tasks-bot-summary" aria-hidden="true">
              {layout.summaryParts.map((part, index) => (
                <span key={part} className="radar-tasks-bot-summary-part">{index > 0 ? `· ${part}` : part}</span>
              ))}
            </span>
          </button>
        </div>
        {groupOpen ? (
          <ul className="radar-task-list">
            {layout.needs.map(task => taskRow(bot, task))}
            {layout.active.map(task => taskRow(bot, task))}
            {layout.waitingShown.map(task => taskRow(bot, task))}
            {layout.waitingFolded.length > 0
              ? foldRow(`${bot.key}:waiting`, waitingOpen ? "Fewer waiting" : `${layout.waitingFolded.length} more waiting`, waitingOpen, () => toggleExpanded(`${bot.key}:waiting`))
              : null}
            {waitingOpen ? layout.waitingFolded.map(task => taskRow(bot, task)) : null}
            {layout.closedToday.length > 0
              ? foldRow(`${bot.key}:done`, doneLabel, doneOpen, () => toggleExpanded(`${bot.key}:done`))
              : null}
            {doneOpen ? layout.closedToday.map(task => taskRow(bot, task)) : null}
            {layout.quiet && layout.closedToday.length === 0 ? <li className="radar-task-empty">Nothing open</li> : null}
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
          <BotTaskFace bot={bot} />
          <span className="radar-task-body">
            <bdi dir="auto" className="radar-task-title">{need.question}</bdi>
            <bdi dir="auto" className="radar-task-line">{where}</bdi>
          </span>
        </button>
      </li>
    );
  };

  const notFiledOpen = isOpen("@not-filed", false);
  const unlinkedOpen = isOpen("@unlinked", unlinked.length > 0);
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
          ) : <span className="radar-tasks-count-static">{needs.length}</span>}
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

      <section className="radar-tasks-extra" aria-label="Unlinked work">
        <button type="button" className="radar-tasks-section-toggle" aria-expanded={unlinkedOpen}
          onClick={() => toggle("@unlinked", unlinked.length > 0)}>
          <span aria-hidden="true">{unlinkedOpen ? "▾" : "▸"}</span> Unlinked work <span className="radar-tasks-section-count">{unlinked.length}</span>
        </button>
        {unlinkedOpen ? (
          unlinked.length === 0 ? <p className="radar-task-empty">Every running worker belongs to a task.</p> : (
            <ul className="radar-task-list">
              {unlinked.map(item => (
                <li key={item.threadId}>
                  <button type="button" className="radar-task-row radar-task-unlinked"
                    aria-current={item.threadId === activeThreadId ? "page" : undefined}
                    onClick={() => open(item.threadId)}>
                    <BotTaskFace bot={item.bot} size={16} />
                    <span className="radar-task-body">
                      <bdi dir="auto" className="radar-task-title">{item.title || "Untitled thread"}</bdi>
                      <span className="radar-task-line">{shortBotName(item.bot.name)} · no task</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section className="radar-tasks-extra" aria-label="Not filed">
        <button type="button" className="radar-tasks-section-toggle" aria-expanded={notFiledOpen}
          onClick={() => toggle("@not-filed", false)}>
          <span aria-hidden="true">{notFiledOpen ? "▾" : "▸"}</span> Not filed <span className="radar-tasks-section-count">{data.notFiled.length}</span>
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
          {peek.task.line ? <bdi dir="auto" className="radar-task-peek-line">{peek.task.line}</bdi> : null}
          {peek.task.needs ? <bdi dir="auto" className="radar-task-peek-line">Asks: {peek.task.needs.question}</bdi> : null}
          {peek.task.origin !== "verified" ? <span className="radar-task-peek-meta">{peek.task.origin === "imported" ? "Filed from history" : "Not confirmed as yours: filed only"}</span> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
