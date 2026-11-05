import { useRef, useState, type KeyboardEvent } from "react";
import { useWholeItems } from "./useWholeItems";
import { experimental_ThreadActionsMenu as ThreadActionsMenu, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { askFirst, deskNeedLine, since, stageText, stageTitle } from "./stage";
import { BotTaskFace, useDeskPress } from "./BotsView";
import { Isolated } from "./Isolated";
import { clauseCut, cutAtWord } from "./workText";
import { taskNotNowKey } from "@/lib/notNow";

const SHORT_WHAT = 62;
const OPEN_WHAT = 96;

const MIN_CONTEXT = 18;

export function fitWhat(what: string, max: number): string {
  if (what.length <= max) return what;
  const at = what.indexOf(" · ");
  if (at < 0) return cutAtWord(what, max);
  const head = what.slice(0, at);
  const room = max - at - 3;
  const context = room >= MIN_CONTEXT ? clauseCut(what.slice(at + 3), room) : "";
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
  threadId: string;
  thread?: PluginSidebarThread;
  state?: "answered" | "gone" | "later";
  notNowKey?: string;
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const question = askFirst(stageText(task.needs?.question || task.line || task.title), stageTitle(task.title));
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: question || "Has a question for you", kind: "ask",
        at: task.observedAt !== undefined ? task.observedAt - task.ageMs : undefined,
        threadId: task.needs?.threadId ?? task.conversationThreadId ?? bot.coordinatorThreadId, notNowKey: taskNotNowKey(task) });
    }
    for (const desk of sortDesks(bot.desks.filter(needsYou))) {
      items.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: bot.name, what: deskNeedLine(desk), kind: "desk", at: desk.updatedAt,
        threadId: desk.threadId ?? bot.coordinatorThreadId, notNowKey: `desk:${desk.id}` });
    }
  }
  return items;
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

export function NeedsSummary({ data, extra, answered, hold, now, activeThreadId, onOpen, onMenu, onNotNow, parked }: {
  data: BotTasksData;
  activeThreadId: string | null;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  now: number;
  onOpen: (threadId: string) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (item: NeedItem) => void;
  parked?: (key: string) => boolean;
}) {
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useHeld([...needItems(data), ...extra, ...answered], hold, parked);
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
  const state = !items.length ? "empty" : waiting ? "waiting" : "settled";
  useWholeItems(listRef, open, shown.length);
  const title = state === "empty" ? "Needs you" : waiting ? "Needs you" : "Nothing left for you";
  return <section className="stage-needs" data-state={state} data-open={open || undefined}
    aria-label={waiting ? `Needs you: ${waiting}` : "Needs you: nothing right now"}>
    <h2 className="stage-needs-title">
      <span className="stage-needs-dot" aria-hidden="true" />
      <span className="stage-needs-heading">{title}</span>
      {more > 0 ? <button type="button" className="stage-needs-more" aria-expanded={open} aria-label={open ? "Show less" : moreLabel} title={open ? undefined : moreLabel} onClick={() => setAll(value => !value)}>
        <span className="stage-needs-more-pill"><span>{open ? "Show less" : "Show all"}</span>
          {open ? null : <span className="stage-needs-more-faces" data-count={Math.min(hiddenBots.length, 3)} aria-hidden="true">{hiddenBots.slice(0, 3).map(item => { const face = faces.get(item.botKey); return face ? <BotTaskFace key={item.id} bot={face} size={16} /> : <Icon key={item.id} name="MessageSquare" className="stage-needs-thread-icon" />; })}</span>}
          <Icon name="ChevronDown" aria-hidden="true" /></span>
      </button> : null}
      {waiting ? <span className="stage-needs-count" title={`${waiting} waiting for you`} aria-hidden="true">{waiting}</span> : null}
    </h2>
    {state === "empty" ? <p className="stage-needs-empty" role="status">
      <Icon name="Check" aria-hidden="true" />
      <span><b>Nothing right now</b><span>Bot questions and approvals show here</span></span>
    </p> : <ul ref={listRef}>
      {shown.map(item => <NeedRow key={item.id} item={item} bot={faces.get(item.botKey)} open={open} now={now} current={item.id === currentId} onOpen={onOpen} onMenu={onMenu} onNotNow={onNotNow} />)}
    </ul>}
  </section>;
}

function NeedRow({ item, bot, open, now, current, onOpen, onMenu, onNotNow }: {
  item: NeedItem;
  bot: BotTasksData["bots"][number] | undefined;
  open: boolean;
  now: number;
  current: boolean;
  onOpen: (threadId: string) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
  onNotNow?: (item: NeedItem) => void;
}) {
  const press = useDeskPress();
  const what = item.what;
  const age = item.state ? "" : item.at !== undefined ? since(item.at, now) : "";
  const menuLabel = item.kind === "thread" ? `Actions for ${item.botName}` : botMenuLabel(item.botName, true);
  const asked = age ? askedAgo(age) : "";
  const showMenu = (li: HTMLElement) => {
    if (item.kind === "thread") li.querySelector<HTMLElement>(".stage-needs-menu")?.click(); else onMenu(item, li);
  };
  return <li data-current={current || undefined} {...press}
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
      aria-label={`${item.botName}: ${what.replace(/[.\s]+$/, "")}${item.state === "gone" ? ", done" : item.state === "later" ? ", moved to Later" : ""}${asked ? `, ${asked}` : ""}. Open`} aria-keyshortcuts="ArrowRight"
      onClick={() => onOpen(item.threadId)}>
      {bot ? <BotTaskFace bot={bot} size={16} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
      <span className="stage-needs-copy">
        <span className="stage-needs-who"><b>{item.botName}</b>
          {item.state === "later" ? <span className="stage-needs-later-mark"><Icon name="Clock" aria-hidden="true" />Later</span> : item.state ? <Icon name="Check" aria-hidden="true" className="stage-needs-done" /> : asked ? <span className="stage-needs-age"><span className="stage-needs-age-verb">asked </span>{asked.replace(/^asked /, "")}</span> : null}
        </span>
        <span className="stage-needs-what" dir="auto"><Isolated text={fitWhat(what, open ? OPEN_WHAT : SHORT_WHAT)} /></span>
      </span>
    </button>
    {onNotNow && item.notNowKey && !item.state ? <button type="button" className="stage-needs-later" tabIndex={-1} aria-label={`Not now: ${item.botName}: ${what}`} title="Not now: move to Later until the bot asks again"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onNotNow(item); }}>Not now</button> : null}
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
