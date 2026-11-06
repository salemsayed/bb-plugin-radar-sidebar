import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { useWholeItems } from "./useWholeItems";
import { experimental_ThreadActionsMenu as ThreadActionsMenu, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { deskNeedLine, isOldAsk, since, stageTitle, taskAsk } from "./stage";
import { questionInPanel } from "./questions";
import { BotTaskFace, useDeskPress } from "./BotsView";
import { clauseCut, cutAtWord } from "./workText";
import { FitLines } from "./FitLines";
import { askForms, isChoice, shortChoice } from "./choiceFit";
import { Isolated } from "./Isolated";
import { answerOptions } from "@/lib/botTasks";
import { bringBack, taskNotNowKey, type NotNowToast } from "@/lib/notNow";
import { fillOutcomes, subscribeFill, type FillOutcome } from "@/lib/composerFill";
import { plainNote } from "./workText";

const OPEN_WHAT = 96;

const MIN_CONTEXT = 18;
const OPEN_FORMS = [OPEN_WHAT, 84, 72, 60, 48, 40];
const BOX_ANSWERS = 3;
const PAIR_CHARS = 32;
const SENT_SHOWN_MS = 5 * 60_000;

export function boxAnswers(item: Pick<NeedItem, "kind" | "state" | "inPanel" | "old" | "options">): string[] {
  if (item.kind !== "ask" || item.state || item.inPanel || item.old) return [];
  const options = item.options ?? [];
  return options.length && options.length <= BOX_ANSWERS ? options.map(option => plainNote(option)) : [];
}

function liveOutcome(item: NeedItem, outcomes: ReadonlyMap<string, FillOutcome>, now: number): FillOutcome | null {
  const outcome = outcomes.get(item.id);
  if (!outcome || item.at !== undefined && outcome.at < item.at) return null;
  if (outcome.result === "sent" && now - outcome.at > SENT_SHOWN_MS) return null;
  return outcome;
}

function outsideBrackets(cut: string, whole: string): string {
  const open = cut.lastIndexOf("(");
  if (open < 0 || cut.indexOf(")", open) >= 0) return cut;
  const before = cut.slice(0, open).replace(/[\s,;:\-\u2013\u2014]+$/, "");
  if (before.length < 12) return cut;
  const asks = /\?\s*$/.test(whole.split(" · ")[0]!);
  return asks ? `${before}?` : `${before}\u2026`;
}

export function fitWhat(what: string, max: number): string {
  if (what.length <= max) return what;
  const at = what.indexOf(" · ");
  if (at < 0) return outsideBrackets(cutAtWord(what, max), what);
  const head = what.slice(0, at);
  const room = max - at - 3;
  const context = room >= MIN_CONTEXT ? clauseCut(what.slice(at + 3), room) : "";
  if (head.length > max) return outsideBrackets(cutAtWord(head, max), what);
  return context ? `${head} · ${context}` : head;
}

export function botMenuLabel(name: string, needs: boolean): string {
  return needs ? `What ${name} needs from you, tasks and settings` : `${name}: tasks, desks and settings`;
}

export function askedAgo(age: string): string {
  return age === "now" ? "asked just now" : `asked ${age} ago`;
}

export interface NeedItem {
  id: string;
  botKey: string;
  botName: string;
  what: string;
  kind: "ask" | "desk" | "thread";
  at?: number;
  since?: "asked" | "open";
  threadId: string;
  messageSeq?: number;
  thread?: PluginSidebarThread;
  state?: "answered" | "gone" | "later";
  notNowKey?: string;
  title?: string;
  inPanel?: boolean;
  old?: boolean;
  options?: string[];
  askedAt?: number;
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const title = stageTitle(task.title, task.outcome);
      const question = taskAsk(task);
      const place = askPlace(task, bot.coordinatorThreadId);
      const options = answerOptions(task.needs?.options);
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: question || "Has a question for you", kind: "ask", title, ...(options.length ? { options } : {}),
        ...askTime(task), ...place, notNowKey: taskNotNowKey(task), ...(questionInPanel(task) ? { inPanel: true } : {}), ...(isOldAsk(task) ? { old: true } : {}) });
    }
    for (const desk of sortDesks(bot.desks.filter(needsYou))) {
      items.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: bot.name, what: deskNeedLine(desk), kind: "desk", at: desk.updatedAt, title: deskNeedLine(desk).replace(/\s+·.*$/, ""),
        threadId: desk.threadId ?? bot.coordinatorThreadId, notNowKey: `desk:${desk.id}` });
    }
  }
  return [...oldestFirst(items.filter(item => !item.old)), ...oldestFirst(items.filter(item => item.old))];
}

export function oldestFirst<T extends { at?: number }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.at ?? Infinity) - (b.item.at ?? Infinity) || a.index - b.index).map(({ item }) => item);
}


export function askPlace(task: Pick<BotTasksData["bots"][number]["tasks"][number], "needs" | "conversationThreadId">, coordinatorThreadId: string): { threadId: string; messageSeq?: number } {
  const needs = task.needs;
  if (!needs) return { threadId: task.conversationThreadId ?? coordinatorThreadId };
  if (needs.interactionId) return { threadId: needs.threadId };
  if (needs.messageSeq !== undefined) return { threadId: needs.threadId, messageSeq: needs.messageSeq };
  return { threadId: coordinatorThreadId };
}

export function askTime(task: Pick<BotTasksData["bots"][number]["tasks"][number], "needs" | "observedAt" | "ageMs">): { at?: number; since?: "asked" | "open" } {
  if (task.needs?.askedAt !== undefined) return { at: task.needs.askedAt, since: "asked" };
  return task.observedAt !== undefined ? { at: task.observedAt - task.ageMs, since: "open" } : {};
}

function useHeld(live: NeedItem[], hold: boolean, parked: (key: string) => boolean = () => false): NeedItem[] {
  const [frozen, setFrozen] = useState<NeedItem[] | null>(null);
  if (hold && frozen === null) setFrozen(live);
  if (!hold && frozen !== null) setFrozen(null);
  if (!hold || frozen === null) return live;
  const now = new Map(live.map(item => [item.id, item]));
  return frozen.map(item => now.get(item.id) ?? { ...item, state: item.notNowKey && parked(item.notNowKey) ? "later" as const : "gone" as const });
}

function verticalKeys(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  const box = event.currentTarget.closest(".stage-needs");
  const items = Array.from(box?.querySelectorAll<HTMLElement>(".stage-needs-item") ?? []);
  const at = items.findIndex(item => item.closest("li")?.contains(event.target as Node));
  if (at < 0) return false;
  event.preventDefault();
  if (event.key === "ArrowDown") {
    const next = items[at + 1] ?? box?.closest(".stage")?.querySelector<HTMLElement>('.stage-bots .stage-chat[tabindex="0"], .stage-bots .stage-chat');
    next?.focus();
  } else {
    (items[at - 1] ?? box?.querySelector<HTMLElement>(".stage-needs-more"))?.focus();
  }
  return true;
}

function sideKeys(event: KeyboardEvent<HTMLElement>, onMenu: () => void) {
  const item = event.currentTarget.closest("li");
  if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); onMenu(); return; }
  if (verticalKeys(event)) return;
  const order = Array.from(item?.querySelectorAll<HTMLElement>(".stage-needs-item, .stage-needs-answer, .stage-needs-later, .stage-needs-menu") ?? []);
  const at = order.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  const to = event.key === "ArrowRight" ? order[at + 1] : event.key === "ArrowLeft" ? order[at - 1] : undefined;
  if (to) { event.preventDefault(); to.focus(); }
}

export function notNowLabel(item: Pick<NeedItem, "botName" | "title" | "what"> & { options?: readonly string[] }): string {
  const whole = (item.what || item.title || "").replace(/\s+·.*$/, "");
  const count = item.options?.length ?? 0;
  const title = whole.length <= 56 ? whole : isChoice(whole, count) ? shortChoice(whole, 56, item.title, count) : clauseCut(whole, 56) || cutAtWord(whole, 56);
  return item.botName ? `${title} · ${item.botName}` : title;
}

function readHashSeq(): number | null {
  const match = /(?:^#|&)msg=(\d+)/.exec(location.hash);
  return match ? Number(match[1]) : null;
}

function subscribeHash(change: () => void) {
  window.addEventListener("popstate", change);
  window.addEventListener("hashchange", change);
  return () => { window.removeEventListener("popstate", change); window.removeEventListener("hashchange", change); };
}

function useHashSeq(): number | null {
  return useSyncExternalStore(subscribeHash, readHashSeq, () => null);
}

export interface StaleNote { asOf: string; retrying: boolean; onRetry: () => void }

export function NeedsSummary({ data, extra, answered, hold, now, activeThreadId, checking = false, cold = false, stale, undo = null, inlineUndo = false, onOpen, onMenu, onNotNow, onAnswer, parked }: {
  data: BotTasksData;
  activeThreadId: string | null;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  now: number;
  checking?: boolean;
  cold?: boolean;
  stale?: StaleNote | null;
  undo?: NotNowToast | null;
  inlineUndo?: boolean;
  onOpen: (threadId: string, messageSeq?: number, item?: NeedItem) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (item: NeedItem) => void;
  onAnswer?: (item: NeedItem, label: string) => void;
  parked?: (key: string) => boolean;
}) {
  const outcomes = useSyncExternalStore(subscribeFill, fillOutcomes, fillOutcomes);
  const [all, setAll] = useState(false);
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const focusAt = useRef<number | null>(null);
  const restore = useRef<string | null>(null);
  const isParked = parked ?? (() => false);
  if (!hold && skip.size) setSkip(new Set());
  const fresh = needItems(data);
  const items = useHeld([...oldestFirst([...fresh.filter(item => !item.old), ...extra, ...answered]), ...fresh.filter(item => item.old)], hold, parked).filter(item => !(skip.has(item.id) && item.notNowKey && isParked(item.notNowKey)))
    .map(item => !item.state && liveOutcome(item, outcomes, now)?.result === "sent" ? { ...item, state: "answered" as const } : item);
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  const waiting = checking && cold ? 0 : items.filter(item => !item.state && !item.old).length;
  const more = checking && cold ? 0 : items.length - 1;
  const open = all && more > 0;
  const shown = open ? items : items.slice(0, 1);
  const hidden = items.slice(1);
  const hiddenBots = [...new Map(hidden.map(item => [item.botKey || `thread:${item.threadId}`, item])).values()];
  const hashSeq = useHashSeq();
  const inThread = activeThreadId ? items.filter(item => item.threadId === activeThreadId) : [];
  const currentId = (inThread.find(item => item.messageSeq !== undefined && item.messageSeq === hashSeq) ?? inThread[0])?.id;
  const hiddenNames = hiddenBots.map(item => item.botName);
  const hiddenOld = hidden.filter(item => item.old && !item.state).length;
  const onlyOld = hiddenOld > 0 && hiddenOld === hidden.length;
  const moreLabel = onlyOld ? `Show ${hiddenOld} old ${hiddenOld === 1 ? "ask" : "asks"}${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}, the bot moved on since` : `Show ${more} more${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}${hiddenOld ? `, ${hiddenOld} of them old` : ""}`;
  const moreText = onlyOld ? `${hiddenOld} old` : `${more} more`;
  const state = checking && (cold || !items.length) ? "checking" : !items.length ? "empty" : waiting ? "waiting" : "settled";
  useWholeItems(listRef, open, shown.length);
  useLayoutEffect(() => {
    const back = restore.current;
    if (back && items.some(item => item.id === back && !item.state && !(item.notNowKey && isParked(item.notNowKey)))) {
      restore.current = null;
      const active = document.activeElement;
      if (!active || active === document.body || listRef.current?.contains(active) || active === headRef.current) {
        const index = shown.findIndex(item => item.id === back);
        listRef.current?.querySelectorAll<HTMLElement>(".stage-needs-item")[index]?.focus();
      }
      return;
    }
    const at = focusAt.current;
    if (at === null) return;
    focusAt.current = null;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".stage-needs-item:not([data-state])") ?? []);
    (buttons[Math.min(at, buttons.length - 1)] ?? headRef.current)?.focus();
  });
  const title = state === "empty" || state === "checking" ? "Needs you" : waiting ? "Needs you" : items.some(item => item.old && !item.state) ? "Nothing new for you" : "Nothing left for you";
  const notNowFrom = (item: NeedItem, index: number, keyboard: boolean) => {
    if (!onNotNow) return;
    if (keyboard || inlineUndo) setSkip(prev => new Set(prev).add(item.id));
    if (keyboard) { focusAt.current = index; restore.current = item.id; }
    onNotNow(item);
  };
  const staleLive = !!stale && items.length > 0;
  const [stalePinned, setStalePinned] = useState<boolean | null>(null);
  if (hold && stalePinned === null) setStalePinned(staleLive);
  if (!hold && stalePinned !== null) setStalePinned(null);
  const staleShown = (stalePinned ?? staleLive) && stale ? stale : null;
  const undoRow = undo && !items.some(item => item.notNowKey === undo.key && !item.state) ? <UndoLine undo={undo} /> : null;
  if ((state === "empty" || state === "checking") && undoRow) {
    return <section className="stage-needs" data-state="empty" data-slim="" aria-label="Moved to Later">
      <h2 className="stage-needs-title stage-needs-line" ref={headRef} tabIndex={-1}>{undoRow}</h2>
    </section>;
  }
  if (state === "empty" || state === "checking") {
    const offline = stale && !checking ? stale : null;
    return <section className="stage-needs" data-state={offline ? "offline" : state} data-slim="" aria-label={offline ? "Needs you: bots can't be reached" : state === "checking" ? "Needs you: checking" : "Nothing needs you"}>
      <h2 className="stage-needs-title stage-needs-line" ref={headRef} tabIndex={-1}>
        <Icon name={offline ? "AlertCircle" : state === "checking" ? "Clock" : "Check"} aria-hidden="true" className="stage-needs-line-icon" />
        {offline ? <StaleText stale={offline} /> : <span className="stage-needs-line-text" role="status">{state === "checking" ? "Checking for new questions\u2026" : "Nothing needs you"}</span>}
        {offline ? <RetryButton stale={offline} at="line" /> : null}
      </h2>
    </section>;
  }
  return <section className="stage-needs" data-state={state} data-open={open || undefined} data-stale={staleShown ? "" : undefined}
    aria-label={waiting ? `Needs you: ${waiting}` : "Nothing needs you"}>
    <h2 className="stage-needs-title" ref={headRef} tabIndex={-1}>
      {staleShown ? null : <span className="stage-needs-dot" aria-hidden="true" />}
      <span className="stage-needs-heading">{title}</span>
      {more > 0 ? <button type="button" className="stage-needs-more" aria-expanded={open} aria-label={open ? "Show less" : moreLabel} title={open ? "Show less" : moreLabel} onClick={() => setAll(value => !value)}>
        <span className="stage-needs-more-pill">{open && staleShown ? null : <span>{open ? "Show less" : moreText}</span>}
          <Icon name="ChevronDown" aria-hidden="true" /></span>
      </button> : null}
      {staleShown ? <RetryButton stale={staleShown} at="head" /> : null}
      {waiting ? <span className="stage-needs-count" title={`${waiting} waiting for you`} aria-hidden="true">{waiting}</span> : null}
    </h2>
    {staleShown ? <StaleLine stale={staleShown} /> : null}
    <ul ref={listRef}>
      {undoRow ? <li className="stage-needs-undo">{undoRow}</li> : null}
      {shown.map((item, index) => <NeedRow key={item.id} item={item} bot={faces.get(item.botKey)} now={now} current={item.id === currentId} offline={!!staleShown} outcome={liveOutcome(item, outcomes, now)} onOpen={onOpen} onMenu={onMenu} onNotNow={onNotNow && !staleShown ? keyboard => notNowFrom(item, index, keyboard) : undefined} onAnswer={onAnswer ? label => onAnswer(item, label) : undefined} />)}
    </ul>
  </section>;
}

function RetryButton({ stale, at }: { stale: StaleNote; at: "head" | "line" }) {
  return <button type="button" className="stage-needs-retry" data-at={at} disabled={stale.retrying} aria-label={stale.retrying ? "Trying to reach the bots" : `Retry: bots can't be reached, showing what we had at ${stale.asOf}`} onClick={stale.onRetry}>{stale.retrying ? "Trying…" : "Retry"}</button>;
}

function UndoLine({ undo }: { undo: NotNowToast }) {
  return <span className="stage-needs-undo-line" role="status" aria-live="polite">
    <Icon name={undo.error ? "AlertCircle" : "Clock"} aria-hidden="true" className="stage-needs-line-icon" />
    <span className="stage-needs-line-text" title={undo.error ?? `Moved to Later: ${undo.label}`}>{undo.error ?? "Moved to Later"}<span className="stage-needs-sr">{undo.error ? "" : `: ${undo.label}`}</span></span>
    {undo.error ? null : <button type="button" className="stage-needs-undo-button" disabled={undo.busy} aria-label={`Undo: bring back ${undo.label}`} onClick={() => void bringBack(undo.key, undo.label)}>Undo</button>}
  </span>;
}

function StaleLine({ stale }: { stale: StaleNote }) {
  return <p className="stage-needs-stale">
    <Icon name="AlertCircle" aria-hidden="true" className="stage-needs-stale-icon" />
    <StaleText stale={stale} />
    <RetryButton stale={stale} at="line" />
  </p>;
}

function StaleText({ stale }: { stale: StaleNote }) {
  const ref = useRef<HTMLSpanElement>(null);
  const forms = [`Can't reach bots · showing ${stale.asOf}`, `Can't reach bots · ${stale.asOf}`];
  const [fit, setFit] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const style = getComputedStyle(box);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const at = forms.findIndex(form => textWidth(form, font) <= box.clientWidth);
      setFit(at < 0 ? forms.length - 1 : at);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [stale.asOf]);
  return <span className="stage-needs-stale-text" role="alert" ref={ref} title={`Bots can't be reached. Showing what we had at ${stale.asOf}`}>
    <span aria-hidden="true">{forms[fit]}</span>
    <span className="stage-needs-sr">Bots can't be reached. Showing what we had at {stale.asOf}</span>
  </span>;
}

let measureCanvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * 6;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

export function ageLabel(age: string, _since?: "asked" | "open"): string {
  return askedAgo(age);
}

function NeedRow({ item, bot, now, current, offline, outcome, onOpen, onMenu, onNotNow, onAnswer }: {
  item: NeedItem;
  bot: BotTasksData["bots"][number] | undefined;
  now: number;
  current: boolean;
  offline: boolean;
  outcome: FillOutcome | null;
  onOpen: (threadId: string, messageSeq?: number, item?: NeedItem) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (keyboard: boolean) => void;
  onAnswer?: (label: string) => void;
}) {
  const press = useDeskPress();
  const [inside, setInside] = useState(false);
  const itemRef = useRef<HTMLButtonElement>(null);
  const what = item.what;
  const age = item.state ? "" : item.at !== undefined ? since(item.at, now) : "";
  const shownAge = item.old && age ? `${age} old` : age ? askedAgo(age) : "";
  const shortName = item.kind === "thread" ? item.botName : item.botName.replace(/\s+Bot$/, "");
  const menuLabel = item.kind === "thread" ? `Actions for ${item.botName}` : botMenuLabel(item.botName, true);
  const asked = item.old && age ? `old ask from ${age} ago, the bot has moved on since` : age ? askedAgo(age) : "";
  const showMenu = (li: HTMLElement) => {
    if (item.kind === "thread") li.querySelector<HTMLElement>(".stage-needs-menu")?.click(); else onMenu(item, li);
  };
  const parkable = !!item.notNowKey && !item.state;
  const canPark = !!onNotNow && parkable;
  const answers = onAnswer ? boxAnswers(item) : [];
  const sending = outcome?.result === "sending";
  const note = outcome?.result === "draft" ? "Your draft is in the message box: send or clear it first" : outcome?.result === "failed" ? "Not sent. Try again" : sending ? "Sending\u2026" : "";
  const sentAs = item.state === "answered" && outcome?.result === "sent" ? outcome.text : "";
  const footStatus = item.state === "later" ? <span className="stage-needs-later-mark"><Icon name="Clock" aria-hidden="true" />Later</span>
    : sentAs ? <span className="stage-needs-later-mark stage-needs-sent"><Icon name="Check" aria-hidden="true" className="stage-needs-done" /><span>Sent: <Isolated text={`\u201c${sentAs}\u201d`} /></span></span>
    : item.state ? <span className="stage-needs-later-mark"><Icon name="Check" aria-hidden="true" className="stage-needs-done" />{item.state === "answered" ? "Answered" : "Done"}</span>
    : shownAge ? <span className="stage-needs-age">{shownAge}</span> : null;
  const hint = item.inPanel ? "Show the question" : answers.length ? "Open the chat" : item.options?.length ? "Open: its answers show above the message box" : "Open";
  return <li data-current={current || undefined} data-old={item.old || undefined} data-state={item.state} {...press}
    onFocus={() => setInside(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInside(false); }}
    onContextMenu={event => {
      press.onContextMenu(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      showMenu(event.currentTarget);
    }}
    onKeyDown={event => sideKeys(event, () => showMenu(event.currentTarget))}>
    <button type="button" ref={itemRef} className="stage-needs-item" data-kind={item.kind} data-state={item.state} data-old={item.old || undefined} title={`${item.botName}: ${what}`}
      aria-current={current ? "page" : undefined}
      aria-label={`${item.botName}: ${what.replace(/[.\s]+$/, "")}${item.state === "gone" ? ", done" : item.state === "later" ? ", moved to Later" : sentAs ? `, you sent ${sentAs}` : ""}${asked ? `, ${asked}` : ""}. ${hint}${answers.length ? `. Answers: ${answers.join(" or ")}` : ""}${canPark ? ". Right arrow for Not now and more" : ""}`} aria-keyshortcuts={canPark ? "ArrowRight" : undefined}
      aria-haspopup={item.inPanel ? "dialog" : undefined}
      onClick={event => { if (item.inPanel) onMenu(item, event.currentTarget.closest("li") ?? event.currentTarget); else onOpen(item.threadId, item.messageSeq, item); }}>
      {bot ? <BotTaskFace bot={bot} size={16} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
      <span className="stage-needs-copy">
        <span className="stage-needs-who"><b>{shortName}</b></span>
        <FitLines className="stage-needs-what" forms={askForms(what, OPEN_FORMS, fitWhat, item.title, item.options?.length ?? 0)} />
      </span>
    </button>
    {answers.length ? <div className="stage-needs-answers" role="group" aria-label={`Answers to: ${what}`} data-count={answers.length} data-pair={answers.length === 2 && answers.every(label => label.length <= PAIR_CHARS) || undefined}>
      {answers.map(label => <button key={label} type="button" className="stage-needs-answer" disabled={sending} aria-label={`Send \u201c${label}\u201d to ${item.botName}: opens the chat and sends it`} title="Opens the chat and sends this reply"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onAnswer!(label); }}><Isolated text={label} /></button>)}
    </div> : null}
    <div className="stage-needs-foot" onClick={event => { if (!(event.target instanceof Element && event.target.closest("button"))) itemRef.current?.click(); }}>
      <span className="stage-needs-status" aria-hidden="true">{footStatus}{note ? <span className="stage-needs-off" role="status">{note}</span> : offline && parkable ? <span className="stage-needs-off">{"Not now\u00a0unavailable"}</span> : null}</span>
      {canPark ? <button type="button" className="stage-needs-later radar-not-now" tabIndex={inside ? 0 : -1} aria-label={`Not now: ${notNowLabel(item)}`} title="Not now: move to Later until the bot asks again"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          const keyboard = event.detail === 0;
          if (!keyboard) itemRef.current?.focus({ preventScroll: true });
          onNotNow!(keyboard);
        }}><span className="radar-not-now-pill">Not now</span></button> : null}
      {item.kind === "thread" && item.thread ? <ThreadActionsMenu thread={threadActionTarget(item.thread)} side="bottom" align="end" sideOffset={4}
        trigger={props => <button {...props} type="button" className="stage-needs-menu" tabIndex={inside ? 0 : -1} aria-label={menuLabel} title="Actions"
          onClick={event => { props.onClick?.(event); event.stopPropagation(); }}>
          <Icon name="MoreHorizontal" aria-hidden="true" />
        </button>} />
        : item.kind !== "thread" ? <button type="button" className="stage-needs-menu" tabIndex={inside ? 0 : -1} aria-haspopup="dialog" aria-label={menuLabel} title={menuLabel}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onMenu(item, event.currentTarget.closest("li") ?? event.currentTarget); }}>
          <Icon name="MoreHorizontal" aria-hidden="true" />
        </button> : null}
    </div>
  </li>;
}
