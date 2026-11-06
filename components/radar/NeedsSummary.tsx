import { answerSides } from "./answerSides";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { experimental_ThreadActionsMenu as ThreadActionsMenu, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { askOptions, deskNeedLine, isOldAsk, since, stageTitle, taskAsk } from "./stage";
import { questionInPanel } from "./questions";
import { BotTaskFace, useDeskPress } from "./BotsView";
import { clauseCut, cutAtWord } from "./workText";
import { FitLines, fitWords } from "./FitLines";
import { askForms, isChoice, questionCuts, shortChoice } from "./choiceFit";
import { Isolated } from "./Isolated";
import { bringBack, taskNotNowKey, type NotNowToast } from "@/lib/notNow";
import { fillOutcomes, subscribeFill, type FillOutcome } from "@/lib/composerFill";
import { capitalFirst, plainNote } from "./workText";
import { recommendedOption, withoutMarks } from "./recommend";
import { AnswerLabel, AskImpact, answerName } from "./AnswerLabel";

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
  consequence?: string;
  recommended?: string;
}

export const ONE_FORM = 120;

export function oneForm(what: string, title = "", count = 0): string {
  const head = what.split(" \u00b7 ")[0]!.trim();
  if (head.length <= ONE_FORM) return what;
  const forms = askForms(head, OPEN_FORMS, fitWhat, title, count);
  return forms.find(form => form.length <= ONE_FORM) ?? forms[forms.length - 1] ?? head;
}

export function oneForms(what: string, sizes: readonly number[], title = "", count = 0): string[] {
  const short = oneForm(what, title, count);
  return [...new Set([short, ...askForms(short, sizes, fitWhat, title, count)])];
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const title = stageTitle(task.title, task.outcome);
      const question = taskAsk(task);
      const place = askPlace(task, bot.coordinatorThreadId);
      const options = askOptions(task);
      const recommended = task.needs?.recommended ?? recommendedOption(options, task.needs?.question ?? "");
      const what = recommended ? withoutMarks(question) : question;
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: what || "Has a question for you", kind: "ask", title, ...(options.length ? { options } : {}),
        ...(task.needs?.consequence ? { consequence: task.needs.consequence } : {}), ...(recommended && options.includes(recommended) ? { recommended } : {}),
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

function useHeld(live: NeedItem[], hold: boolean, rebase: number, parked: (key: string) => boolean = () => false): { items: NeedItem[]; arrivals: NeedItem[] } {
  const [frozen, setFrozen] = useState<{ items: NeedItem[]; rebase: number } | null>(null);
  if (hold && (frozen === null || frozen.rebase !== rebase)) setFrozen({ items: live, rebase });
  if (!hold && frozen !== null) setFrozen(null);
  if (!hold || frozen === null) return { items: live, arrivals: [] };
  const now = new Map(live.map(item => [item.id, item]));
  const kept = new Set(frozen.items.map(item => item.id));
  return {
    items: frozen.items.map(item => now.get(item.id) ?? { ...item, state: item.notNowKey && parked(item.notNowKey) ? "later" as const : "gone" as const }),
    arrivals: live.filter(item => !kept.has(item.id) && !item.state && !item.old),
  };
}

export function arrivalForms(arrivals: readonly Pick<NeedItem, "botName" | "kind">[]): string[] {
  const names = [...new Set(arrivals.map(item => item.kind === "thread" ? "a thread" : item.botName.replace(/\s+Bot$/, "")))];
  const asks = arrivals.every(item => item.kind === "ask");
  const who = names[0]!;
  const lead = /^a /.test(who) ? capitalFirst(who) : who;
  if (arrivals.length === 1) return asks ? [`New question from ${who}`, `${lead} has a question`, `${lead} asks`] : [`${lead} needs you`];
  return asks ? [`${arrivals.length} new questions`, `${arrivals.length} new`] : [`${arrivals.length} new for you`, `${arrivals.length} new`];
}

function FitOne({ forms, className }: { forms: readonly string[]; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(0);
  const key = forms.join("\n");
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
  }, [key]);
  return <span className={className} role="status" ref={ref}>{forms[fit]}</span>;
}

function ArrivalText({ lead, what, answers }: { lead: string; what: string; answers: readonly string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = answers.join("\n");
  const leads = answers.map(answer => /^(yes|no)\b/i.exec(answer.trim())?.[1]);
  const yesNo = answers.length === 2 && leads.every(Boolean) && new Set(leads.map(lead => lead!.toLowerCase())).size === 2 ? leads.map(lead => capitalFirst(lead!.toLowerCase())).join(" or ") : "";
  const tails = answers.length > 1 ? [answers.join(" / "), ...(yesNo ? [yesNo] : []), `${answers.length} answers`] : [];
  const [shown, setShown] = useState<{ text: string; tail: string }>({ text: what, tail: tails[0] ?? "" });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const host = box.parentElement;
      if (!host || box.clientWidth <= 0) return;
      const lines = parseFloat(getComputedStyle(box).lineHeight) || 15;
      const probe = document.createElement("span");
      probe.className = box.className;
      probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;inset-inline-start:0;top:0;width:${box.clientWidth}px;display:block;overflow:visible;-webkit-line-clamp:none;line-clamp:none`;
      host.appendChild(probe);
      const fits = (form: string, tail = "") => {
        const name = document.createElement("b");
        name.textContent = `${lead}:`;
        const parts: (Node | string)[] = [name, ` ${form}`];
        if (tail) { const more = document.createElement("span"); more.className = "stage-needs-arrival-answers"; more.textContent = ` \u00b7 ${tail}`; parts.push(more); }
        probe.replaceChildren(...parts);
        return probe.scrollHeight <= lines * 2 + 1;
      };
      const forms = [what, ...questionCuts(what)];
      let pick: { text: string; tail: string } | null = null;
      for (const tail of tails) {
        const form = forms.find(f => fits(f, tail));
        if (form !== undefined) { pick = { text: form, tail }; break; }
      }
      setShown(pick ?? { text: forms.find(form => fits(form)) ?? fitWords(what, form => fits(form)), tail: "" });
      probe.remove();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [lead, what, key]);
  return <span className="stage-needs-arrival-text" dir="auto" ref={ref}><b>{lead}:</b> <Isolated text={shown.text} />{shown.tail ? <span className="stage-needs-arrival-answers">{" \u00b7 "}<Isolated text={shown.tail} /></span> : null}</span>;
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

export function NeedsSummary({ data, extra, answered, hold, watching = false, now, activeThreadId, checking = false, cold = false, stale, undo = null, inlineUndo = false, onOpen, onMenu, onNotNow, onAnswer, parked }: {
  data: BotTasksData;
  activeThreadId: string | null;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  watching?: boolean;
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
  const [rebase, setRebase] = useState(0);
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const [lined, setLined] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const focusAt = useRef<number | null>(null);
  const restore = useRef<string | null>(null);
  const isParked = parked ?? (() => false);
  const frozen = (hold || watching) && !checking;
  if (!frozen && skip.size) setSkip(new Set());
  const fresh = needItems(data);
  const held = useHeld([...oldestFirst([...fresh.filter(item => !item.old), ...extra, ...answered]), ...fresh.filter(item => item.old)], frozen, rebase, parked);
  const arrivals = held.arrivals;
  const items = held.items.filter(item => !(skip.has(item.id) && item.notNowKey && isParked(item.notNowKey)))
    .map(item => !item.state && liveOutcome(item, outcomes, now)?.result === "sent" ? { ...item, state: "answered" as const } : item);
  const reveal = () => setRebase(value => value + 1);
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  const waiting = checking && cold ? 0 : items.filter(item => !item.state && !item.old).length + arrivals.length;
  const more = checking && cold ? 0 : items.length - 1 + arrivals.length;
  const open = all && items.length > 1;
  const shown = open ? items : items.slice(0, 1);
  const hidden = [...items.slice(1), ...arrivals];
  const hiddenBots = [...new Map(hidden.map(item => [item.botKey || `thread:${item.threadId}`, item])).values()];
  const hashSeq = useHashSeq();
  const inThread = activeThreadId ? items.filter(item => item.threadId === activeThreadId) : [];
  const currentId = (inThread.find(item => item.messageSeq !== undefined && item.messageSeq === hashSeq) ?? inThread[0])?.id;
  const hiddenNames = hiddenBots.map(item => item.botName);
  const hiddenOld = hidden.filter(item => item.old && !item.state).length;
  const onlyOld = hiddenOld > 0 && hiddenOld === hidden.length;
  const collapse = open && !arrivals.length;
  const allNew = arrivals.length > 0 && arrivals.length === hidden.length;
  const moreLabel = onlyOld ? `Show ${hiddenOld} old ${hiddenOld === 1 ? "ask" : "asks"}${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}, the bot moved on since` : `Show ${more} ${allNew ? "new" : "more"}${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}${hiddenOld ? `, ${hiddenOld} of them old` : ""}`;
  const moreText = onlyOld ? `${hiddenOld} old` : allNew ? `${more} new` : `${more} more`;
  const pillText = stale && items.length > 0 && !(open && arrivals.length) ? collapse ? "" : `+${more}` : collapse ? "Show less" : open ? `${arrivals.length} new` : moreText;
  const pillLabel = collapse ? "Show less" : open ? `Show ${arrivals.length} new from ${[...new Set(arrivals.map(item => item.botName))].join(" and ")}` : moreLabel;
  const olderOpen = items.filter(item => item.old && !item.state).length;
  const state = checking && (cold || !items.length) ? "checking" : !items.length ? (arrivals.length ? "arrived" : "empty") : waiting ? "waiting" : olderOpen ? "older" : "settled";
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
  const shownKey = open ? shown.map(item => item.id).join("|") : "";
  useLayoutEffect(() => {
    const list = listRef.current;
    const box = list?.closest<HTMLElement>(".stage-needs");
    if (!open || !list || !box) { setLined(prev => prev.size ? new Set() : prev); return; }
    let scroller: HTMLElement | null = box.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return;
    const sb = scroller.getBoundingClientRect(), bb = box.getBoundingClientRect(), lb = list.getBoundingClientRect();
    const top = sb.top - scroller.scrollTop;
    const room = scroller.clientHeight - (scroller.scrollHeight - (bb.bottom - top)) - (lb.top - top) - (bb.bottom - lb.bottom);
    const rows = Array.from(list.querySelectorAll<HTMLElement>(":scope > li[data-need]"));
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const full = rows.map(row => row.getBoundingClientRect().height + gap);
    if (full.reduce((sum, h) => sum + h, 0) <= room + 1) { setLined(prev => prev.size ? new Set() : prev); return; }
    const line = (matchMedia("(pointer: coarse)").matches ? 44 : 36) + gap;
    let keep = 0;
    for (let k = full.length; k >= 0; k--) {
      if (full.slice(0, k).reduce((sum, h) => sum + h, 0) + (full.length - k) * line <= room + 1) { keep = k; break; }
    }
    setLined(new Set(rows.slice(keep).map(row => row.dataset.need!)));
  }, [open, shownKey]);
  const title = state === "empty" || state === "checking" ? "Needs you" : waiting ? "Needs you" : olderOpen ? `${olderOpen} older ${olderOpen === 1 ? "question" : "questions"}` : "Nothing left for you";
  const notNowFrom = (item: NeedItem, index: number, keyboard: boolean) => {
    if (!onNotNow) return;
    if (keyboard || inlineUndo) setSkip(prev => new Set(prev).add(item.id));
    if (keyboard) { focusAt.current = index; restore.current = item.id; }
    onNotNow(item);
  };
  const staleShown = stale && items.length > 0 ? stale : null;
  const undoRow = undo && !items.some(item => item.notNowKey === undo.key && !item.state) ? <UndoLine undo={undo} /> : null;
  if ((state === "empty" || state === "checking") && undoRow) {
    return <section className="stage-needs" data-state="empty" data-slim="" aria-label="Moved to Later">
      <h2 className="stage-needs-title stage-needs-line" ref={headRef} tabIndex={-1}>{undoRow}</h2>
    </section>;
  }
  if (state === "arrived") {
    const forms = arrivalForms(arrivals);
    const text = forms[0]!;
    const names = [...new Set(arrivals.map(item => item.botName))].join(" and ");
    const single = arrivals.length === 1 ? arrivals[0]! : null;
    const lead = single ? single.kind === "thread" ? single.botName : single.botName.replace(/\s+Bot$/, "") : "";
    return <section className="stage-needs" data-state="arrived" data-slim="" aria-label={`Needs you: ${arrivals.length}`}>
      <h2 className="stage-needs-title stage-needs-line" ref={headRef} tabIndex={-1}>
        <button type="button" className="stage-needs-arrival" title={single ? `${lead}: ${single.what}` : undefined}
          aria-label={single ? `${lead}: ${single.what.replace(/[.\s]+$/, "")}.${boxAnswers(single).length > 1 ? ` ${boxAnswers(single).length} answers.` : ""} Show` : `${text} from ${names}: show them`}
          onClick={() => { focusAt.current = 0; reveal(); }}>
          <span className="stage-needs-dot" aria-hidden="true" />
          {single ? <ArrivalText lead={lead} what={single.what} answers={boxAnswers(single)} /> : <FitOne className="stage-needs-line-text" forms={forms} />}
          <span className="stage-needs-more-pill" data-icon-only={single ? "" : undefined} aria-hidden="true">{single ? null : <span>Show</span>}<Icon name="ChevronDown" aria-hidden="true" /></span>
        </button>
      </h2>
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
      {staleShown ? <Icon name="AlertCircle" aria-hidden="true" className="stage-needs-stale-icon" /> : <span className="stage-needs-dot" aria-hidden="true" />}
      {staleShown ? <StaleText stale={staleShown} /> : <span className="stage-needs-heading">{title}</span>}
      {more > 0 ? <button type="button" className="stage-needs-more" aria-expanded={collapse} aria-label={pillLabel} title={pillLabel}
        onClick={() => { if (arrivals.length) { reveal(); setAll(true); } else setAll(value => !value); }}>
        <span className="stage-needs-more-pill" data-icon-only={pillText ? undefined : ""}>{pillText ? <span>{pillText}</span> : null}<Icon name="ChevronDown" aria-hidden="true" /></span>
      </button> : null}
      {staleShown ? <RetryButton stale={staleShown} at="head" /> : null}
      {waiting && !staleShown && (collapse || more === 0) ? <span className="stage-needs-count" title={`${waiting} waiting for you`} aria-hidden="true">{waiting}</span> : null}
    </h2>
    <ul ref={listRef}>
      {undoRow ? <li className="stage-needs-undo">{undoRow}</li> : null}
      {shown.map((item, index) => <NeedRow key={item.id} item={item} bot={faces.get(item.botKey)} now={now} current={item.id === currentId} offline={!!staleShown} outcome={liveOutcome(item, outcomes, now)}
        lined={open && lined.has(item.id)}
        folded={open && index > 0 && item.id !== currentId && !unfolded.has(item.id) && !!onAnswer && boxAnswers(item).length > 0}
        onUnfold={() => setUnfolded(prev => new Set(prev).add(item.id))}
        onOpen={onOpen} onMenu={onMenu} onNotNow={onNotNow && !staleShown ? keyboard => notNowFrom(item, index, keyboard) : undefined} onAnswer={onAnswer ? label => onAnswer(item, label) : undefined} />)}
    </ul>
  </section>;
}

function RetryButton({ stale, at }: { stale: StaleNote; at: "head" | "line" }) {
  return <button type="button" className="stage-needs-retry" data-at={at} disabled={stale.retrying} aria-label={stale.retrying ? "Trying to reach the bots" : `Retry: bots can't be reached, showing what we had at ${stale.asOf}`} onClick={stale.onRetry}>{at === "head" ? <Icon name="RotateCcw" aria-hidden="true" className="stage-needs-retry-icon" /> : null}<span className="stage-needs-retry-text">{stale.retrying ? "Trying…" : "Retry"}</span></button>;
}

function UndoLine({ undo }: { undo: NotNowToast }) {
  return <span className="stage-needs-undo-line" role="status" aria-live="polite">
    <Icon name={undo.error ? "AlertCircle" : "Clock"} aria-hidden="true" className="stage-needs-line-icon" />
    <span className="stage-needs-line-text" title={undo.error ?? `Moved to Later: ${undo.label}`}>{undo.error ?? "Moved to Later"}<span className="stage-needs-sr">{undo.error ? "" : `: ${undo.label}`}</span></span>
    {undo.error ? null : <button type="button" className="stage-needs-undo-button" disabled={undo.busy} aria-label={`Undo: bring back ${undo.label}`} onClick={() => void bringBack(undo.key, undo.label)}>Undo</button>}
  </span>;
}

function StaleText({ stale }: { stale: StaleNote }) {
  const ref = useRef<HTMLSpanElement>(null);
  const forms = [`Can't refresh · showing ${stale.asOf}`, `Can't refresh · ${stale.asOf}`, "Can't refresh"];
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
  return <span className="stage-needs-stale-text" role="alert" ref={ref} title={`Can't refresh the bots. Showing what we had at ${stale.asOf}`}>{forms[fit]}</span>;
}

let measureCanvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * 6;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

export function isRecommended(item: Pick<NeedItem, "recommended">, label: string): boolean {
  return !!item.recommended && plainNote(item.recommended) === label;
}

export function ageLabel(age: string, _since?: "asked" | "open"): string {
  return askedAgo(age);
}

function WordLine({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]!.contentRect.width);
      setWidth(prev => Math.abs(prev - next) > 1 ? next : prev);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    const host = node?.parentElement;
    if (!node || !host) return;
    const room = node.getBoundingClientRect().width;
    const probe = document.createElement("span");
    probe.className = node.className;
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:auto;max-width:none;white-space:nowrap;display:inline;overflow:visible";
    host.appendChild(probe);
    const fits = (form: string) => { probe.textContent = form; return probe.getBoundingClientRect().width <= room + 0.5; };
    const next = fitWords(text, fits);
    probe.remove();
    setShown(next);
  }, [text, width]);
  return <span ref={ref} className={className} dir="auto"><Isolated text={shown} /></span>;
}

function NeedRow({ item, bot, now, current, offline, outcome, lined = false, folded: foldedAsked = false, onUnfold, onOpen, onMenu, onNotNow, onAnswer }: {
  item: NeedItem;
  lined?: boolean;
  folded?: boolean;
  onUnfold?: () => void;
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
  const folded = foldedAsked && !lined;
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
  const canPark = (!!onNotNow || offline) && parkable && !folded && !lined;
  const sentAs = item.state === "answered" && outcome?.result === "sent" ? outcome.text : "";
  const answers = onAnswer && !folded && !lined ? boxAnswers(item) : [];
  const spent = !!item.state && !sentAs && !lined ? onAnswer ? boxAnswers({ ...item, state: undefined }) : [] : [];
  const keepPark = !!item.state && !sentAs && !!item.notNowKey && !lined;
  const sending = outcome?.result === "sending";
  const note = outcome?.result === "draft" ? "Your draft is in the message box: send or clear it first" : outcome?.result === "failed" ? "Not sent. Try again" : sending ? "Sending\u2026" : "";
  const headStatus = item.state === "later" ? <span className="stage-needs-later-mark"><Icon name="Clock" aria-hidden="true" />Later</span>
    : item.state && !sentAs ? <span className="stage-needs-later-mark"><Icon name="Check" aria-hidden="true" className="stage-needs-done" />{item.state === "answered" ? "Answered" : "Done"}</span>
    : sentAs ? null
    : shownAge ? <span className="stage-needs-age">{shownAge}</span> : null;
  const parkOnly = canPark && !(answers.length && !sentAs) && !spent.length && !note && !keepPark && !sentAs && !(item.consequence && !folded);
  const liRef = useRef<HTMLLIElement>(null);
  const [inlinePark, setInlinePark] = useState<number | null>(null);
  useLayoutEffect(() => {
    const li = liRef.current;
    if (!li || !parkOnly || matchMedia("(pointer: coarse)").matches) { setInlinePark(null); return; }
    const measure = () => {
      const text = li.querySelector<HTMLElement>(".stage-needs-what");
      const foot = li.querySelector<HTMLElement>(".stage-needs-foot");
      const pill = li.querySelector<HTMLElement>(".stage-needs-foot .radar-not-now");
      if (!text || !foot || !pill) return;
      if (text.scrollHeight > text.clientHeight + 1) { setInlinePark(null); return; }
      const box = text.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.bottom <= box.bottom + 1 && rect.top >= box.top - 1);
      if (!lines.length) { setInlinePark(null); return; }
      const lastTop = Math.max(...lines.map(rect => rect.top));
      const last = lines.filter(rect => Math.abs(rect.top - lastTop) < 4);
      const right = Math.max(...last.map(rect => rect.right));
      const end = li.getBoundingClientRect().right - 4;
      const width = pill.getBoundingClientRect().width;
      if (end - right < width + 12) { setInlinePark(null); return; }
      const applied = Number.parseFloat(getComputedStyle(foot).marginTop) || 0;
      const naturalTop = foot.getBoundingClientRect().top - applied;
      const lineTop = Math.min(...last.map(rect => rect.top));
      const lift = Math.round(naturalTop - lineTop - 2);
      const placed = { left: end - width, right: end, top: lineTop + 2, bottom: lineTop + 2 + pill.getBoundingClientRect().height };
      const hits = lines.some(rect => rect.right > placed.left && rect.left < placed.right && rect.bottom > placed.top + 0.5 && rect.top < placed.bottom - 0.5);
      setInlinePark(hits || lift <= 0 ? null : lift);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(li);
    return () => observer.disconnect();
  }, [parkOnly, what]);
  const hint = folded ? "Show its answers" : item.inPanel ? "Show the question" : answers.length ? "Open the chat" : item.options?.length ? "Open: its answers show above the message box" : "Open";
  return <li ref={liRef} data-need={item.id} data-lined={lined || undefined} data-current={current || undefined} data-old={item.old || undefined} data-state={item.state} data-folded={folded || undefined} {...press}
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
    <button type="button" ref={itemRef} className="stage-needs-item" data-lined={lined || undefined} data-kind={item.kind} data-state={item.state} data-old={item.old || undefined} title={`${item.botName}: ${what}`}
      aria-current={current ? "page" : undefined}
      aria-label={`${item.botName}: ${what.replace(/[.\s]+$/, "")}${item.consequence && !item.state ? `. ${item.consequence.replace(/[.\s]+$/, "")}` : ""}${item.state === "gone" ? ", done" : item.state === "later" ? ", moved to Later" : sentAs ? `, you sent ${sentAs}` : ""}${asked ? `, ${asked}` : ""}. ${hint}${answers.length ? `. Answers: ${answers.join(" or ")}` : ""}${canPark ? ". Right arrow for Not now and more" : ""}`} aria-keyshortcuts={canPark ? "ArrowRight" : undefined}
      aria-haspopup={item.inPanel && !folded ? "dialog" : undefined} aria-expanded={folded ? false : undefined}
      onClick={event => { if (folded) onUnfold?.(); else if (item.inPanel) onMenu(item, event.currentTarget.closest("li") ?? event.currentTarget); else onOpen(item.threadId, item.messageSeq, item); }}>
      {bot ? <BotTaskFace bot={bot} size={16} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
      <span className="stage-needs-copy">
        <span className="stage-needs-who"><b>{shortName}</b><span className="stage-needs-status" aria-hidden="true">{headStatus}</span></span>
        {lined ? <WordLine className="stage-needs-what" text={what} /> : <FitLines className="stage-needs-what" forms={oneForms(what, OPEN_FORMS, item.title, item.options?.length ?? 0)} />}
        {!folded && !lined && !item.state ? <AskImpact className="stage-needs-impact" text={item.consequence} /> : null}
        {folded ? <span className="stage-needs-unfold" aria-hidden="true">{`${boxAnswers(item).length} answers`}<Icon name="ChevronDown" aria-hidden="true" /></span> : null}
      </span>
    </button>
    <span className="stage-needs-tools">
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
    </span>
    {sentAs && !lined ? <p className="stage-needs-sent" aria-hidden="true"><Icon name="Check" aria-hidden="true" className="stage-needs-done" /><span>Sent: <Isolated text={`\u201c${sentAs}\u201d`} /></span></p> : null}
    {answers.length && !sentAs || spent.length || keepPark || note || canPark ? <div className="stage-needs-foot" data-inline-park={parkOnly && inlinePark !== null || undefined} style={parkOnly && inlinePark !== null ? { marginTop: -inlinePark } : undefined} onClick={event => { if (!(event.target instanceof Element && event.target.closest("button"))) itemRef.current?.click(); }}>
      {answers.length && !sentAs ? <div className="stage-needs-answers radar-answers" role="group" aria-label={`Answers to: ${what}`} data-count={answers.length} ref={answerSides}>
        {answers.map(label => <button key={label} type="button" className="stage-needs-answer radar-answer" disabled={sending} aria-label={`Send ${answerName(label, isRecommended(item, label))} to ${item.botName}: opens the chat and sends it`} title="Opens the chat and sends this reply"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onAnswer!(label); }}><AnswerLabel label={label} recommended={isRecommended(item, label)} /></button>)}
      </div> : null}
      {spent.length ? <div className="stage-needs-answers radar-answers" aria-hidden="true">{spent.map(label => <button key={label} type="button" className="stage-needs-answer radar-answer" data-spent="" disabled tabIndex={-1}><Isolated text={label} /></button>)}</div> : null}
      {note ? <span className="stage-needs-off" role="status">{note}</span> : null}
      {keepPark ? <span className="stage-needs-later radar-not-now" data-spent="" aria-hidden="true"><span className="radar-not-now-pill">Not now</span></span> : null}
      {canPark ? <button type="button" className="stage-needs-later radar-not-now" tabIndex={inside ? 0 : -1} aria-disabled={offline || undefined}
          aria-label={offline ? `Not now is unavailable while the bots can't be reached: ${notNowLabel(item)}` : `Not now: ${notNowLabel(item)}`} title={offline ? "Not now is unavailable while the bots can't be reached" : "Not now: move to Later until the bot asks again"}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            if (offline || !onNotNow) return;
            const keyboard = event.detail === 0;
            if (!keyboard) itemRef.current?.focus({ preventScroll: true });
            onNotNow(keyboard);
          }}><span className="radar-not-now-pill">Not now</span></button> : null}
    </div> : null}
  </li>;
}
