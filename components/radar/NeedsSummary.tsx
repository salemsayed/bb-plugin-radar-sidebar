import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useWholeItems } from "./useWholeItems";
import { experimental_ThreadActionsMenu as ThreadActionsMenu, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { deskNeedLine, needAsk, since, stageTitle } from "./stage";
import { BotTaskFace, useDeskPress } from "./BotsView";
import { Isolated } from "./Isolated";
import { clauseCut, cutAtWord } from "./workText";
import { taskNotNowKey } from "@/lib/notNow";

const SHORT_WHAT = 62;
const OPEN_WHAT = 96;

const MIN_CONTEXT = 18;

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

export function openFor(age: string): string {
  return age === "now" ? "open just now" : `open ${age}`;
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
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const title = stageTitle(task.title, task.outcome);
      const question = needAsk(task.needs?.question || task.line || task.title, title);
      const place = askPlace(task, bot.coordinatorThreadId);
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: question || "Has a question for you", kind: "ask", title,
        ...askTime(task), ...place, notNowKey: taskNotNowKey(task) });
    }
    for (const desk of sortDesks(bot.desks.filter(needsYou))) {
      items.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: bot.name, what: deskNeedLine(desk), kind: "desk", at: desk.updatedAt, title: deskNeedLine(desk).replace(/\s+·.*$/, ""),
        threadId: desk.threadId ?? bot.coordinatorThreadId, notNowKey: `desk:${desk.id}` });
    }
  }
  return items;
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

function sideKeys(event: KeyboardEvent<HTMLElement>, onMenu: () => void) {
  const item = event.currentTarget.closest("li");
  if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); onMenu(); return; }
  const order = [".stage-needs-item", ".stage-needs-later", ".stage-needs-menu"].map(selector => item?.querySelector<HTMLElement>(selector)).filter((node): node is HTMLElement => !!node);
  const at = order.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  const to = event.key === "ArrowRight" ? order[at + 1] : event.key === "ArrowLeft" ? order[at - 1] : undefined;
  if (to) { event.preventDefault(); to.focus(); }
}

export function notNowLabel(item: Pick<NeedItem, "botName" | "title" | "what">): string {
  const title = cutAtWord(item.title || item.what.replace(/\s+·.*$/, ""), 56);
  return item.botName ? `${title} · ${item.botName}` : title;
}

export interface StaleNote { asOf: string; retrying: boolean; onRetry: () => void }

export function NeedsSummary({ data, extra, answered, hold, now, activeThreadId, checking = false, stale, onOpen, onMenu, onNotNow, parked }: {
  data: BotTasksData;
  activeThreadId: string | null;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  now: number;
  checking?: boolean;
  stale?: StaleNote | null;
  onOpen: (threadId: string, messageSeq?: number) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (item: NeedItem) => void;
  parked?: (key: string) => boolean;
}) {
  const [all, setAll] = useState(false);
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const focusAt = useRef<number | null>(null);
  const restore = useRef<string | null>(null);
  const isParked = parked ?? (() => false);
  if (!hold && skip.size) setSkip(new Set());
  const items = useHeld([...needItems(data), ...extra, ...answered], hold, parked).filter(item => !(skip.has(item.id) && item.notNowKey && isParked(item.notNowKey)));
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  const waiting = items.filter(item => !item.state).length;
  const more = items.length - 1;
  const open = all && more > 0;
  const shown = open ? items : items.slice(0, 1);
  const hidden = items.slice(1);
  const hiddenBots = [...new Map(hidden.map(item => [item.botKey || `thread:${item.threadId}`, item])).values()];
  const currentId = activeThreadId ? items.find(item => item.threadId === activeThreadId)?.id : undefined;
  const hiddenNames = hiddenBots.map(item => item.botName);
  const moreLabel = `Show ${more} more${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}`;
  const state = !items.length ? checking ? "checking" : "empty" : waiting ? "waiting" : "settled";
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
  const title = state === "empty" || state === "checking" ? "Needs you" : waiting ? "Needs you" : "Nothing left for you";
  const notNowFrom = (item: NeedItem, index: number, keyboard: boolean) => {
    if (!onNotNow) return;
    if (keyboard) { setSkip(prev => new Set(prev).add(item.id)); focusAt.current = index; restore.current = item.id; }
    onNotNow(item);
  };
  const staleShown = stale && items.length ? stale : null;
  return <section className="stage-needs" data-state={state} data-open={open || undefined} data-stale={staleShown ? "" : undefined}
    aria-label={waiting ? `Needs you: ${waiting}` : state === "checking" ? "Needs you: checking" : "Needs you: nothing right now"}>
    <h2 className="stage-needs-title" ref={headRef} tabIndex={-1}>
      {staleShown ? <>
        <Icon name="AlertCircle" aria-hidden="true" className="stage-needs-stale-icon" />
        <span className="stage-needs-heading" role="alert" title={`Can't reach the bots right now. Showing what we had at ${staleShown.asOf}`}>
          <span aria-hidden="true">Not updating · as of {staleShown.asOf}</span>
          <span className="stage-needs-sr">Needs you. Can't reach the bots right now, showing what we had at {staleShown.asOf}</span>
        </span>
        <button type="button" className="stage-needs-retry" disabled={staleShown.retrying} onClick={staleShown.onRetry}>{staleShown.retrying ? "Trying…" : "Retry"}</button>
      </> : <>
      <span className="stage-needs-dot" aria-hidden="true" />
      <span className="stage-needs-heading">{title}</span>
      </>}
      {more > 0 && !staleShown ? <button type="button" className="stage-needs-more" aria-expanded={open} aria-label={open ? "Show less" : moreLabel} title={open ? undefined : moreLabel} onClick={() => setAll(value => !value)}>
        <span className="stage-needs-more-pill"><span>{open ? "Show less" : "Show all"}</span>
          {open ? null : <span className="stage-needs-more-faces" data-count={Math.min(hiddenBots.length, 3)} aria-hidden="true">{hiddenBots.slice(0, 3).map(item => { const face = faces.get(item.botKey); return face ? <BotTaskFace key={item.id} bot={face} size={16} /> : <Icon key={item.id} name="MessageSquare" className="stage-needs-thread-icon" />; })}</span>}
          <Icon name="ChevronDown" aria-hidden="true" /></span>
      </button> : null}
      {waiting && !staleShown ? <span className="stage-needs-count" title={`${waiting} waiting for you`} aria-hidden="true">{waiting}</span> : null}
    </h2>
    {state === "empty" ? <p className="stage-needs-empty" role="status">
      <Icon name="Check" aria-hidden="true" />
      <span><b>Nothing right now</b><span>Bot questions and approvals show here</span></span>
    </p> : state === "checking" ? <p className="stage-needs-empty" role="status">
      <Icon name="Clock" aria-hidden="true" />
      <span><b>Checking for new asks…</b><span>Bot questions and approvals show here</span></span>
    </p> : <ul ref={listRef}>
      {shown.map((item, index) => <NeedRow key={item.id} item={item} bot={faces.get(item.botKey)} open={open} now={now} current={item.id === currentId} onOpen={onOpen} onMenu={onMenu} onNotNow={onNotNow ? keyboard => notNowFrom(item, index, keyboard) : undefined} />)}
    </ul>}
  </section>;
}

const AGE_GAP = 4;
let measureCanvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * 6;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function ageForms(age: string, since: "asked" | "open"): string[] {
  if (since === "open") return age === "now" ? ["open just now", "just now", "now"] : [`open ${age}`, age];
  return age === "now" ? ["asked just now", "asked now", "now"] : [`asked ${age} ago`, `asked ${age}`, age];
}

function useAgeFit(who: RefObject<HTMLElement | null>, name: RefObject<HTMLElement | null>, forms: readonly string[]): number {
  const [fit, setFit] = useState(0);
  const key = forms.join("|");
  useLayoutEffect(() => {
    const box = who.current;
    if (!box || !forms.length) return;
    const measure = () => {
      const style = getComputedStyle(box);
      const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (name.current?.offsetWidth ?? 0) - AGE_GAP;
      const font = `400 11px ${style.fontFamily}`;
      const next = forms.findIndex(form => textWidth(form, font) <= room);
      setFit(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [key]);
  return fit;
}

function NeedRow({ item, bot, open, now, current, onOpen, onMenu, onNotNow }: {
  item: NeedItem;
  bot: BotTasksData["bots"][number] | undefined;
  open: boolean;
  now: number;
  current: boolean;
  onOpen: (threadId: string, messageSeq?: number) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (keyboard: boolean) => void;
}) {
  const press = useDeskPress();
  const whoRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLElement>(null);
  const [inside, setInside] = useState(false);
  const what = item.what;
  const age = item.state ? "" : item.at !== undefined ? since(item.at, now) : "";
  const sinceWord = item.since ?? "asked";
  const forms = age ? ageForms(age, sinceWord) : [];
  const fit = useAgeFit(whoRef, nameRef, forms);
  const menuLabel = item.kind === "thread" ? `Actions for ${item.botName}` : botMenuLabel(item.botName, true);
  const asked = age ? sinceWord === "open" ? openFor(age) : askedAgo(age) : "";
  const showMenu = (li: HTMLElement) => {
    if (item.kind === "thread") li.querySelector<HTMLElement>(".stage-needs-menu")?.click(); else onMenu(item, li);
  };
  const canPark = !!onNotNow && !!item.notNowKey && !item.state;
  return <li data-current={current || undefined} {...press}
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
    <button type="button" className="stage-needs-item" data-kind={item.kind} data-state={item.state} title={`${item.botName}: ${what}`}
      aria-current={current ? "page" : undefined}
      aria-label={`${item.botName}: ${what.replace(/[.\s]+$/, "")}${item.state === "gone" ? ", done" : item.state === "later" ? ", moved to Later" : ""}${asked ? `, ${asked}` : ""}. Open`} aria-keyshortcuts={canPark ? "ArrowRight" : undefined}
      onClick={() => onOpen(item.threadId, item.messageSeq)}>
      {bot ? <BotTaskFace bot={bot} size={16} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
      <span className="stage-needs-copy">
        <span className="stage-needs-who" ref={whoRef}><b ref={nameRef}>{item.botName}</b>
          {item.state === "later" ? <span className="stage-needs-later-mark"><Icon name="Clock" aria-hidden="true" />Later</span> : item.state ? <Icon name="Check" aria-hidden="true" className="stage-needs-done" /> : asked && fit >= 0 ? <span className="stage-needs-age" aria-hidden="true">{forms[fit] ?? forms.at(-1)}</span> : null}
        </span>
        <span className="stage-needs-what" dir="auto"><Isolated text={fitWhat(what, open ? OPEN_WHAT : SHORT_WHAT)} /></span>
      </span>
    </button>
    {canPark ? <button type="button" className="stage-needs-later radar-not-now" tabIndex={inside ? 0 : -1} aria-label={`Not now: ${notNowLabel(item)}`} title="Not now: move to Later until the bot asks again"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        const keyboard = event.detail === 0;
        if (!keyboard) (event.currentTarget.closest("li")?.querySelector<HTMLElement>(".stage-needs-item"))?.focus({ preventScroll: true });
        onNotNow!(keyboard);
      }}><span className="radar-not-now-pill">Not now</span></button> : null}
    {item.kind === "thread" && item.thread ? <ThreadActionsMenu thread={threadActionTarget(item.thread)} side="bottom" align="end" sideOffset={4}
      trigger={props => <button {...props} type="button" className="stage-needs-menu" tabIndex={-1} aria-label={menuLabel} title="Actions"
        onClick={event => { props.onClick?.(event); event.stopPropagation(); }}>
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button>} />
      : item.kind !== "thread" ? <button type="button" className="stage-needs-menu" tabIndex={-1} aria-haspopup="dialog" aria-label={menuLabel} title={menuLabel}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onMenu(item, event.currentTarget.closest("li") ?? event.currentTarget); }}>
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button> : null}
  </li>;
}
