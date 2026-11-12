import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { armAskStrip } from "@/lib/askStrip";
import type { BotTasksBot } from "@/lib/botTasks";
import { requestFill } from "@/lib/composerFill";
import { bringBack, notNow, taskNotNowKey } from "@/lib/notNow";
import { AnswerLabel, AskImpact, answerName } from "../AnswerLabel";
import { answerHint } from "../answerHint";
import { answerRow } from "../answerRow";
import { ago } from "../elapsed";
import { FitLines } from "../FitLines";
import { Isolated } from "../Isolated";
import { askPlace, fitWhat, notNowLabel, oneForms } from "../NeedsSummary";
import { isQuestionRow, questionInPanel } from "../questions";
import { recommendedOption } from "../recommend";
import { askOptions, isOldAsk } from "../stage";
import { capitalFirst, plainNote } from "../workText";
import type { DeskItem, TaskItem } from "./panelModel";
import { deskAsk, deskParts } from "./status";
import { TaskDetails } from "./TaskDetails";
import type { DetailContext } from "./taskDetail";

const QUESTION_FORMS = [140, 120, 100, 84, 70, 56];
const LABEL_CUT = 110;
const ANSWERS_SHOWN = 4;

export type Navigate = (threadId: string, messageSeq?: number) => void;
export type Park = (from: HTMLElement, act: () => Promise<void>) => void;

function flat(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function Pill({ label, hint, name, onClick }: { label: string; hint: string; name: string; onClick: (from: HTMLElement) => void }) {
  return <button type="button" className="dispatch-later-action radar-not-now" aria-label={name} title={hint} onClick={event => onClick(event.currentTarget)}><span className="radar-not-now-pill">{label}</span></button>;
}

export function ParkPill({ parked, label, itemKey, hint, onPark }: { parked: boolean; label: string; itemKey: string; hint: string; onPark: Park }) {
  return parked
    ? <Pill label="Bring back" hint="Put it back in Needs you" name={`Bring back: ${label}`} onClick={from => onPark(from, () => bringBack(itemKey, label))} />
    : <Pill label="Not now" hint={hint} name={`Not now: ${label}`} onClick={from => onPark(from, () => notNow(itemKey, label))} />;
}

export function ContinuePill({ label = "Continue", name, hint, primary = false, onClick }: { label?: string; name: string; hint: string; primary?: boolean; onClick: () => void }) {
  return <button type="button" className="dispatch-task-continue" data-primary={primary || undefined} aria-label={name} title={hint} onClick={onClick}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />{label}</span></button>;
}

function AskShell({ itemKey, old, current, question, onOpen, spoken, meta, children, foot }: { itemKey: string; old: boolean; current: boolean; question: ReactNode; onOpen: () => void; spoken: string; meta: string[]; children?: ReactNode; foot: ReactNode }) {
  return <article className="panel-ask" data-item={itemKey} data-old={old || undefined}>
    <button type="button" className="panel-ask-question" aria-current={current ? "page" : undefined} aria-label={spoken} onClick={onOpen}>{question}</button>
    <p className="panel-ask-meta">{meta.map((part, i) => <span key={i}><Isolated text={part} />{i < meta.length - 1 ? " · " : ""}</span>)}</p>
    {children}
    {foot}
  </article>;
}

export function TaskAskCard({ item, bot, context, current, onNavigate, onPark }: { item: TaskItem; bot: BotTasksBot; context: DetailContext; current: boolean; onNavigate: Navigate; onPark: Park }) {
  const [open, setOpen] = useState(false);
  const { task, title } = item;
  const old = isOldAsk(task);
  const options = old ? [] : askOptions(task).slice(0, ANSWERS_SHOWN);
  const labels = options.map(option => plainNote(option));
  const recommended = task.needs?.recommended ?? recommendedOption(options, task.needs?.question ?? "");
  const consequence = old ? undefined : task.needs?.consequence;
  const whole = item.status.words;
  const asked = whole.toLowerCase().startsWith(`${title.toLowerCase()} · `) ? whole.slice(title.length + 3) : whole;
  const named = !flat(asked).startsWith(flat(title.replace(/\u2026$/, ""))) && !isQuestionRow(task);
  const askedAt = task.needs?.askedAt;
  const when = askedAt === undefined ? "" : old ? `asked ${ago(askedAt, context.now)}, the bot has moved on since` : `asked ${ago(askedAt, context.now)}`;
  const meta = [named ? title : "", named ? when : capitalFirst(when)].filter(Boolean);
  const arm = () => {
    const place = askPlace(task, bot.coordinatorThreadId);
    armAskStrip({ key: `ask:${task.id}`, threadId: place.threadId, messageSeq: place.messageSeq, question: task.needs?.question ?? whole, title, options: askOptions(task), botName: bot.name, askedAt, ...(consequence ? { consequence } : {}), ...(recommended ? { recommended } : {}) });
    return place;
  };
  const go = () => { const place = arm(); onNavigate(place.threadId, place.messageSeq); };
  const outside = isQuestionRow(task) && questionInPanel(task);
  const label = notNowLabel({ botName: bot.name, title, what: fitWhat(whole, LABEL_CUT), options: task.needs?.options });
  const proceed = () => {
    if (isQuestionRow(task)) { go(); return; }
    window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: title.slice(0, 80) } }));
    onNavigate(bot.coordinatorThreadId);
  };
  return <AskShell itemKey={item.key} old={old} current={current} onOpen={go} spoken={`${title}. ${asked}`} meta={meta}
    question={<FitLines className="panel-ask-fit" forms={oneForms(asked, QUESTION_FORMS, title, options.length)} />}
    foot={<>
      <div className="panel-ask-foot">
        {isQuestionRow(task) || old ? <span /> : <button type="button" className="panel-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>Details<Icon name="ChevronDown" aria-hidden="true" /></button>}
        <span className="panel-ask-actions">
          <ParkPill parked={false} label={label} itemKey={taskNotNowKey(task)} hint="Not now: move to Later until the bot asks again" onPark={onPark} />
          <ContinuePill primary={!old} label={outside ? "Reply in chat" : "Continue"} name={outside ? `Reply to ${title} in the bot's chat` : `Continue ${title}`} hint={outside ? "The bot asked this outside its chat; reply to it in its chat" : "Answer in the bot's chat"} onClick={proceed} />
        </span>
      </div>
      {open ? <div className="panel-details"><TaskDetails item={item} context={context} onOpen={onNavigate} /></div> : null}
    </>}>
    {consequence ? <AskImpact className="dispatch-card-impact" text={consequence} /> : null}
    {labels.length ? <div className="dispatch-options">
      {labels.length > 1 ? <span className="dispatch-options-label" aria-hidden="true">{answerHint()}</span> : null}
      <div className="radar-answers" role="group" aria-label={`Answers to ${title}`} data-count={labels.length} ref={answerRow}>
        {labels.map(answer => {
          const best = !!recommended && plainNote(recommended) === answer;
          return <button key={answer} type="button" className="dispatch-option radar-answer" aria-label={`Send ${answerName(answer, best)} to ${bot.name}: opens the chat and sends it`} title="Opens the chat and sends this reply" onClick={() => {
            const place = arm();
            requestFill(place.threadId, answer, labels, true);
            onNavigate(place.threadId, place.messageSeq);
          }}><AnswerLabel label={answer} recommended={best} /></button>;
        })}
      </div>
    </div> : null}
  </AskShell>;
}

export function DeskAskCard({ item, botName, now, current, onNavigate, onPark }: { item: DeskItem; botName: string; now: number; current: boolean; onNavigate: Navigate; onPark: Park }) {
  const { desk } = item;
  const { channel, person, subject } = deskParts(desk);
  const { question, about } = deskAsk(desk);
  const open = () => { if (desk.threadId) onNavigate(desk.threadId); };
  const label = notNowLabel({ botName, title: subject, what: question });
  const names = (text: string) => !!person && text.includes(person);
  const meta = [names(question) || names(about) ? channel : [channel, person].filter(Boolean).join(" with "), `asked ${ago(desk.updatedAt, now)}`];
  return <AskShell itemKey={item.key} old={false} current={current} onOpen={open} spoken={`${subject}. ${question}`} meta={meta}
    question={<><span className="panel-ask-fit" dir="auto"><Isolated text={question} /></span>{about ? <span className="panel-ask-about" dir="auto"><Isolated text={about} /></span> : null}</>}
    foot={<div className="panel-ask-foot"><span /><span className="panel-ask-actions">
      <ParkPill parked={false} label={label} itemKey={item.key} hint="Not now: move to Later until the desk changes" onPark={onPark} />
      {desk.threadId ? <ContinuePill primary name={`Continue ${subject}`} hint="Continue in this chat" onClick={open} /> : null}
    </span></div>} />;
}
