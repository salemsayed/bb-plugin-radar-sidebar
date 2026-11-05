import { useState, type KeyboardEvent } from "react";
import { experimental_ThreadActionsMenu as ThreadActionsMenu, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { askFirst, deskNeedLine, since, stageText, stageTitle } from "./stage";
import { BotTaskFace } from "./BotsView";
import { Isolated } from "./Isolated";
import { cutAtWord } from "./workText";

const SHORT_WHAT = 62;
const OPEN_WHAT = 96;

function fitWhat(what: string, max: number): string {
  if (what.length <= max) return what;
  const at = what.indexOf(" · ");
  if (at < 0 || at > max - 12) return what;
  return `${what.slice(0, at)} · ${cutAtWord(what.slice(at + 3), max - at - 3)}`;
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
  state?: "answered" | "gone";
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const question = askFirst(stageText(task.needs?.question || task.line || task.title), stageTitle(task.title));
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: question || "Has a question for you", kind: "ask",
        at: task.observedAt !== undefined ? task.observedAt - task.ageMs : undefined,
        threadId: task.needs?.threadId ?? task.conversationThreadId ?? bot.coordinatorThreadId });
    }
    for (const desk of sortDesks(bot.desks.filter(needsYou))) {
      items.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: bot.name, what: deskNeedLine(desk), kind: "desk", at: desk.updatedAt,
        threadId: desk.threadId ?? bot.coordinatorThreadId });
    }
  }
  return items;
}


function useHeld(live: NeedItem[], hold: boolean): NeedItem[] {
  const [frozen, setFrozen] = useState<NeedItem[] | null>(null);
  if (hold && frozen === null) setFrozen(live);
  if (!hold && frozen !== null) setFrozen(null);
  if (!hold || frozen === null) return live;
  const now = new Map(live.map(item => [item.id, item]));
  return frozen.map(item => now.get(item.id) ?? { ...item, state: "gone" as const });
}

function sideKeys(event: KeyboardEvent<HTMLElement>, onMenu: () => void) {
  const item = event.currentTarget.closest("li");
  if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); onMenu(); return; }
  if (event.key === "ArrowRight" && event.target === item?.querySelector(".stage-needs-item")) { event.preventDefault(); item?.querySelector<HTMLElement>(".stage-needs-menu")?.focus(); }
  if (event.key === "ArrowLeft" && event.target === item?.querySelector(".stage-needs-menu")) { event.preventDefault(); item?.querySelector<HTMLElement>(".stage-needs-item")?.focus(); }
}

export function NeedsSummary({ data, extra, answered, hold, now, onOpen, onMenu }: {
  data: BotTasksData;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  now: number;
  onOpen: (threadId: string) => void;
  onMenu: (item: NeedItem, at: HTMLElement) => void;
}) {
  const [all, setAll] = useState(false);
  const items = useHeld([...needItems(data), ...extra, ...answered], hold);
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  const waiting = items.filter(item => !item.state).length;
  const more = items.length - 1;
  const open = all && more > 0;
  const shown = open ? items : items.slice(0, 1);
  const hidden = items.slice(1);
  const hiddenBots = [...new Map(hidden.map(item => [item.botKey || item.botName, item])).values()];
  const hiddenNames = hiddenBots.map(item => item.botName);
  const moreLabel = `Show ${more} more${hiddenNames.length ? ` from ${hiddenNames.join(" and ")}` : ""}`;
  const state = !items.length ? "empty" : waiting ? "waiting" : "settled";
  const title = state === "empty" ? "Needs you" : waiting ? "Needs you" : "Nothing left for you";
  return <section className="stage-needs" data-state={state} data-open={open || undefined}
    aria-label={waiting ? `Needs you: ${waiting}` : "Needs you: nothing right now"}>
    <h2 className="stage-needs-title">
      <span className="stage-needs-dot" aria-hidden="true" />
      <span className="stage-needs-heading">{title}</span>
      {more > 0 ? <button type="button" className="stage-needs-more" aria-expanded={open} aria-label={open ? "Show less" : moreLabel} title={open ? undefined : moreLabel} onClick={() => setAll(value => !value)}>
        <span className="stage-needs-more-pill"><span>{open ? "Show less" : `+${more} more`}</span>
          {open ? null : <span className="stage-needs-more-faces" aria-hidden="true">{hiddenBots.slice(0, 3).map(item => { const face = faces.get(item.botKey); return face ? <BotTaskFace key={item.id} bot={face} size={16} /> : <Icon key={item.id} name="MessageSquare" className="stage-needs-thread-icon" />; })}</span>}
          <Icon name="ChevronDown" aria-hidden="true" /></span>
      </button> : null}
      {waiting ? <span className="stage-needs-count" title={`${waiting} waiting for you`}>{waiting}</span> : null}
    </h2>
    {state === "empty" ? <p className="stage-needs-empty" role="status">
      <Icon name="Check" aria-hidden="true" />
      <span><b>Nothing right now</b><span>Bot questions and approvals show here</span></span>
    </p> : <ul>
      {shown.map(item => {
        const bot = faces.get(item.botKey);
        const what = item.what;
        const age = item.state ? "" : item.at !== undefined ? since(item.at, now) : "";
        const menuLabel = item.kind === "thread" ? `Actions for ${item.botName}` : botMenuLabel(item.botName, true);
        const asked = age ? askedAgo(age) : "";
        return <li key={item.id} onKeyDown={event => sideKeys(event, () => {
          const menu = event.currentTarget.querySelector<HTMLElement>(".stage-needs-menu");
          if (item.kind === "thread") menu?.click(); else onMenu(item, event.currentTarget);
        })}>
          <button type="button" className="stage-needs-item" data-kind={item.kind} data-state={item.state} title={`${item.botName}: ${what}`}
            aria-label={`${item.botName}: ${what}${item.state === "gone" ? ", done" : ""}${asked ? `, ${asked}` : ""}. Open`} aria-keyshortcuts="ArrowRight"
            onClick={() => onOpen(item.threadId)}>
            {bot ? <BotTaskFace bot={bot} size={16} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
            <span className="stage-needs-copy">
              <span className="stage-needs-who"><b>{item.botName}</b>
                {item.state ? <Icon name="Check" aria-hidden="true" className="stage-needs-done" /> : asked ? <span className="stage-needs-age">{asked}</span> : null}
              </span>
              <span className="stage-needs-what" dir="auto"><Isolated text={fitWhat(what, open ? OPEN_WHAT : SHORT_WHAT)} /></span>
            </span>
          </button>
          {item.kind === "thread" && item.thread ? <ThreadActionsMenu thread={threadActionTarget(item.thread)} side="bottom" align="end" sideOffset={4}
            trigger={props => <button {...props} type="button" className="stage-needs-menu" tabIndex={-1} aria-label={menuLabel} title="Actions"
              onClick={event => { props.onClick?.(event); event.stopPropagation(); }}>
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </button>} />
            : item.kind !== "thread" ? <button type="button" className="stage-needs-menu" tabIndex={-1} aria-haspopup="dialog" aria-label={menuLabel} title={menuLabel}
              onClick={event => { event.stopPropagation(); onMenu(item, event.currentTarget.closest("li") ?? event.currentTarget); }}>
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </button> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
