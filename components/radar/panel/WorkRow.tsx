import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { BotTasksBot } from "@/lib/botTasks";
import { isClosed } from "@/lib/botTasks";
import { taskNotNowKey } from "@/lib/notNow";
import { FitLines } from "../FitLines";
import { Isolated } from "../Isolated";
import { askPlace, notNowLabel } from "../NeedsSummary";
import { isQuestionRow, questionInPanel } from "../questions";
import { titleForms } from "../workText";
import { ContinuePill, ParkPill, type Navigate, type Park } from "./AskCard";
import type { WorkItem } from "./panelModel";
import { StatusMark } from "./StatusMark";
import { TaskDetails } from "./TaskDetails";
import type { DetailContext } from "./taskDetail";

function Copy({ item }: { item: WorkItem }) {
  const { words, note } = item.status;
  return <span className="panel-row-copy">
    <b className="panel-row-title" dir="auto">{item.kind === "task" ? <FitLines className="panel-row-fit" forms={titleForms(item.title)} /> : <span className="panel-row-fit panel-row-plain"><Isolated text={item.title} /></span>}</b>
    <span className="panel-row-status"><span className="panel-row-words"><Isolated text={words} /></span>{note ? <span className="panel-row-note">{" · "}<Isolated text={note} /></span> : null}</span>
  </span>;
}

export function WorkRow({ item, bot, context, current, onNavigate, onPark }: { item: WorkItem; bot: BotTasksBot; context: DetailContext; current: boolean; onNavigate: Navigate; onPark: Park }) {
  const [open, setOpen] = useState(false);
  const spoken = `${item.title}. ${[item.status.words, item.status.note].filter(Boolean).join(", ")}`;
  if (item.kind !== "task") {
    const threadId = item.kind === "desk" ? item.desk.threadId : item.threadId;
    const parked = item.kind === "desk" && item.desk.later !== undefined;
    return <li className="panel-row" data-item={item.key} data-mark={item.status.mark} data-acts={parked ? "park" : undefined}>
      <button type="button" className="panel-row-main" disabled={!threadId} aria-current={current ? "page" : undefined} aria-label={`${spoken}. Open its chat`} onClick={() => { if (threadId) onNavigate(threadId); }}>
        <StatusMark mark={item.status.mark} /><Copy item={item} />
        {threadId && !parked ? <Icon name="ChevronRight" className="panel-row-go" aria-hidden="true" /> : null}
      </button>
      {parked ? <span className="panel-row-acts"><ParkPill parked label={notNowLabel({ botName: bot.name, title: item.title, what: item.status.words })} itemKey={item.key} hint="" onPark={onPark} /></span> : null}
    </li>;
  }
  const { task, title } = item;
  const closed = isClosed(task.displayState);
  const question = isQuestionRow(task);
  const outside = question && questionInPanel(task);
  const proceed = () => {
    if (question) { const place = askPlace(task, bot.coordinatorThreadId); onNavigate(place.threadId, place.messageSeq); return; }
    window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: title.slice(0, 80) } }));
    onNavigate(bot.coordinatorThreadId);
  };
  const detailsId = `panel-details-${task.id}`;
  const parked = task.later?.reason === "not-now";
  return <li className="panel-row" data-item={item.key} data-mark={item.status.mark} data-open={open || undefined} data-acts={closed ? undefined : parked ? "park" : outside ? "reply" : "continue"}>
    <button type="button" className="panel-row-main" aria-current={current ? "page" : undefined} aria-expanded={open} aria-controls={open ? detailsId : undefined} aria-label={`${spoken}. ${open ? "Hide" : "Show"} details`} onClick={() => setOpen(value => !value)}>
      <StatusMark mark={item.status.mark} /><Copy item={item} />
    </button>
    <span className="panel-row-acts">
    {parked ? <ParkPill parked label={notNowLabel({ botName: bot.name, title, what: question ? task.needs?.question ?? title : title, options: task.needs?.options })} itemKey={taskNotNowKey(task)} hint="" onPark={onPark} /> : null}
    {closed || parked ? null : <ContinuePill label={outside ? "Reply" : "Continue"} name={outside ? `Reply to ${title} in the bot's chat` : `Continue ${title}`} hint={outside ? "The bot asked this outside its chat; reply to it in its chat" : question ? "Answer in the bot's chat" : "Continue in the bot's chat"} onClick={proceed} />}
    </span>
    {open ? <div className="panel-details" id={detailsId}>
      <TaskDetails item={item} context={context} onOpen={onNavigate} />
      {closed ? <div className="panel-links"><button type="button" className="panel-link" onClick={() => onNavigate(task.conversationThreadId ?? bot.coordinatorThreadId)}>Open the chat where this was done</button></div> : null}
      {parked ? <div className="panel-links"><button type="button" className="panel-link" onClick={proceed}>Continue in chat</button></div> : null}
    </div> : null}
  </li>;
}
