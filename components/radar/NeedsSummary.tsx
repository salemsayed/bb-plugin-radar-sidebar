import { useState } from "react";
import { needsYou, orderedBots, sortDesks, type BotTasksData } from "@/lib/botTasks";
import { Icon } from "@/components/ui/icon";
import { shortBotName } from "./bots";
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
}

export function needItems(data: BotTasksData): NeedItem[] {
  const items: NeedItem[] = [];
  for (const bot of orderedBots(data)) {
    const name = shortBotName(bot.name);
    for (const task of bot.tasks.filter(task => task.displayState === "needs")) {
      const question = stageText(task.needs?.question || task.line || task.title);
      items.push({ id: `ask:${task.id}`, botKey: bot.key, botName: name, what: question || "Has a question for you", kind: "ask",
        at: task.observedAt !== undefined ? task.observedAt - task.ageMs : undefined,
        threadId: task.needs?.threadId ?? task.conversationThreadId ?? bot.coordinatorThreadId });
    }
    for (const desk of sortDesks(bot.desks.filter(needsYou))) {
      items.push({ id: `desk:${desk.id}`, botKey: bot.key, botName: name, what: deskNeedLine(desk), kind: "desk", at: desk.updatedAt,
        threadId: desk.threadId ?? bot.coordinatorThreadId });
    }
  }
  return items;
}

const SHOWN = 4;

export function NeedsSummary({ data, extra, now, onOpen }: {
  data: BotTasksData;
  extra: readonly NeedItem[];
  now: number;
  onOpen: (threadId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const items = [...needItems(data), ...extra];
  const faces = new Map(data.bots.map(bot => [bot.key, bot]));
  if (!items.length) {
    return <p className="stage-needs-clear" role="status"><Icon name="Check" aria-hidden="true" />Nothing needs you right now</p>;
  }
  const shown = all ? items : items.slice(0, SHOWN);
  return <section className="stage-needs" aria-label={`Needs you: ${items.length}`}>
    <h2 className="stage-needs-title"><span className="stage-needs-dot" aria-hidden="true" />Needs you<span className="stage-needs-count">{items.length}</span></h2>
    <ul>
      {shown.map(item => {
        const bot = faces.get(item.botKey);
        return <li key={item.id}>
          <button type="button" className="stage-needs-item" data-kind={item.kind} title={`${item.botName}: ${item.what}`}
            aria-label={`${item.botName}: ${item.what}${item.at !== undefined ? `, ${since(item.at, now)} ago` : ""}. Open`}
            onClick={() => onOpen(item.threadId)}>
            {bot ? <BotTaskFace bot={bot} size={20} /> : <Icon name="MessageSquare" aria-hidden="true" className="stage-needs-thread-icon" />}
            <span className="stage-needs-copy"><b>{item.botName}</b><span dir="auto">{item.what}</span></span>
            {item.at !== undefined ? <span className="stage-needs-age">{since(item.at, now)}</span> : null}
          </button>
        </li>;
      })}
    </ul>
    {items.length > SHOWN ? <button type="button" className="stage-needs-more" aria-expanded={all} onClick={() => setAll(value => !value)}>
      {all ? "Show fewer" : `Show ${items.length - SHOWN} more`}
    </button> : null}
  </section>;
}
