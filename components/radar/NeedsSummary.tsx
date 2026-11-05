import { useState } from "react";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { deskNeedLine, since, stageText } from "./stage";
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
      const question = stageText(task.needs?.question || task.line || task.title);
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: bot.name, what: question ? `Question: ${question}` : "Has a question for you", kind: "ask",
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

const SHOWN = 4;

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
  if (!items.length) {
    return <p className="stage-needs-clear" role="status"><Icon name="Check" aria-hidden="true" />Nothing needs you right now</p>;
  }
  const shown = all ? items : items.slice(0, SHOWN);
  return <section className="stage-needs" data-settled={waiting ? undefined : ""} aria-label={waiting ? `Needs you: ${waiting}` : "Needs you: nothing left"}>
    <h2 className="stage-needs-title"><span className="stage-needs-dot" aria-hidden="true" />{waiting ? "Needs you" : "Nothing left for you"}{waiting ? <span className="stage-needs-count">{waiting}</span> : null}</h2>
    <ul>
      {shown.map(item => {
        const bot = faces.get(item.botKey);
        const what = item.state === "gone" ? "Done, nothing more needed" : item.what;
        const age = item.state ? "" : item.at !== undefined ? since(item.at, now) : "";
        return <li key={item.id}>
          <button type="button" className="stage-needs-item" data-kind={item.kind} data-state={item.state} title={`${item.botName}: ${what}`}
            aria-label={`${item.botName}: ${what}${age ? `, ${age} ago` : ""}. Open`}
            onClick={() => onOpen(item.threadId)}>
            {bot ? <BotTaskFace bot={bot} size={20} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
            <span className="stage-needs-copy"><b>{item.botName}</b><span dir="auto">{what}</span></span>
            {item.state ? <Icon name="Check" aria-hidden="true" className="stage-needs-done" /> : age ? <span className="stage-needs-age">{age}</span> : null}
          </button>
        </li>;
      })}
    </ul>
    {items.length > SHOWN ? <button type="button" className="stage-needs-more" aria-expanded={all} onClick={() => setAll(value => !value)}>
      {all ? "Show fewer" : `Show ${items.length - SHOWN} more`}
    </button> : null}
  </section>;
}
