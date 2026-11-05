import { useState } from "react";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { askFirst, deskNeedLine, since, stageText } from "./stage";
import { BotTaskFace } from "./BotsView";

export interface NeedItem {
  id: string;
  botKey: string;
  botName: string;
  what: string;
  kind: "ask" | "desk" | "thread";
  at?: number;
  threadId: string;
  state?: "answered" | "gone";
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const question = askFirst(stageText(task.needs?.question || task.line || task.title));
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

export function NeedsSummary({ data, extra, answered, hold, now, onOpen }: {
  data: BotTasksData;
  extra: readonly NeedItem[];
  answered: readonly NeedItem[];
  hold: boolean;
  now: number;
  onOpen: (threadId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const items = useHeld([...needItems(data), ...extra, ...answered], hold);
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  const waiting = items.filter(item => !item.state).length;
  const more = items.length - 1;
  const open = all && more > 0;
  const shown = open ? items : items.slice(0, 1);
  const state = !items.length ? "empty" : waiting ? "waiting" : "settled";
  const title = state === "empty" ? "Needs you" : waiting ? "Needs you" : "Nothing left for you";
  return <section className="stage-needs" data-state={state} data-open={open || undefined}
    aria-label={waiting ? `Needs you: ${waiting}` : "Needs you: nothing right now"}>
    <h2 className="stage-needs-title">
      <span className="stage-needs-dot" aria-hidden="true" />
      <span className="stage-needs-heading">{title}</span>
      {more > 0 ? <button type="button" className="stage-needs-more" aria-expanded={open} onClick={() => setAll(value => !value)}>
        {open ? "Show less" : `+${more} more`}
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
        return <li key={item.id}>
          <button type="button" className="stage-needs-item" data-kind={item.kind} data-state={item.state} title={`${item.botName}: ${what}`}
            aria-label={`${item.botName}: ${what}${item.state === "gone" ? ", done" : ""}${age ? `, ${age} ago` : ""}. Open`}
            onClick={() => onOpen(item.threadId)}>
            {bot ? <BotTaskFace bot={bot} size={18} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
            <span className="stage-needs-copy">
              <span className="stage-needs-who"><b>{item.botName}</b>
                {item.state ? <Icon name="Check" aria-hidden="true" className="stage-needs-done" /> : age ? <span className="stage-needs-age">{age}</span> : null}
              </span>
              <span className="stage-needs-what" dir="auto">{what}</span>
            </span>
          </button>
        </li>;
      })}
    </ul>}
  </section>;
}
