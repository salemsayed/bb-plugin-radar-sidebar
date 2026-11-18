import { useEffect, useState, type ReactNode } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { armAskStrip } from "@/lib/askStrip";
import type { BotTasksBot } from "@/lib/botTasks";
import { requestFill } from "@/lib/composerFill";
import { draftIsCurrent } from "@/lib/deskDraft";
import { bringBack, notNow } from "@/lib/notNow";
import { AnswerLabel, AskImpact, answerName } from "../AnswerLabel";
import { answerHint } from "../answerHint";
import { answerRow } from "../answerRow";
import { ago } from "../elapsed";
import { FitLines } from "../FitLines";
import { Isolated } from "../Isolated";
import { askPlace, fitWhat, notNowLabel, oneForms } from "../NeedsSummary";
import { isQuestionRow } from "../questions";
import { recommendedOption } from "../recommend";
import { askOptions } from "../stage";
import { capitalFirst, plainNote } from "../workText";
import type { DeskItem, TaskItem } from "./panelModel";
import { deskAsk, deskParts } from "./status";
import { TaskDetails } from "./TaskDetails";
import type { DetailContext } from "./taskDetail";

const QUESTION_FORMS = [140, 120, 100, 84, 70, 56];
const LABEL_CUT = 110;
const ANSWERS_SHOWN = 4;
const OPTIONS_TAIL = /\s+(?:\u00b7\s+)?Options:\s.+$/is;

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
    : <Pill label="Later" hint={hint} name={`Move to Later: ${label}`} onClick={from => onPark(from, () => notNow(itemKey, label))} />;
}

export function ContinuePill({ label = "Continue", name, hint, primary = false, onClick }: { label?: string; name: string; hint: string; primary?: boolean; onClick: () => void }) {
  return <button type="button" className="dispatch-task-continue" data-primary={primary || undefined} aria-label={name} title={hint} onClick={onClick}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />{label}</span></button>;
}

function AskShell({ itemKey, current, from = false, question, onOpen, spoken, meta, children, foot }: { itemKey: string; current: boolean; from?: boolean; question: ReactNode; onOpen: () => void; spoken: string; meta: string[]; children?: ReactNode; foot: ReactNode }) {
  return <article className="panel-ask" data-item={itemKey} data-from={from || undefined}>
    <button type="button" className="panel-ask-question" aria-current={current ? "page" : undefined} aria-label={spoken} onClick={onOpen}>{question}</button>
    <p className="panel-ask-meta">{meta.map((part, i) => <span key={i}><Isolated text={part} />{i < meta.length - 1 ? " · " : ""}</span>)}</p>
    {children}
    {foot}
  </article>;
}

export function TaskAskCard({ item, bot, context, current, from = false, onNavigate, onPark }: { item: TaskItem; bot: BotTasksBot; context: DetailContext; current: boolean; from?: boolean; onNavigate: Navigate; onPark: Park }) {
  const [open, setOpen] = useState(false);
  const { task, title } = item;
  const options = askOptions(task).slice(0, ANSWERS_SHOWN);
  const labels = options.map(option => plainNote(option));
  const recommended = task.needs?.recommended ?? recommendedOption(options, task.needs?.question ?? "");
  const consequence = task.needs?.consequence;
  const whole = item.status.words;
  const untitled = whole.toLowerCase().startsWith(`${title.toLowerCase()} \u00b7 `) ? whole.slice(title.length + 3) : whole;
  const asked = options.length ? untitled.replace(OPTIONS_TAIL, "") : untitled;
  const named = !flat(asked).startsWith(flat(title.replace(/\u2026$/, ""))) && !isQuestionRow(task);
  const askedAt = task.needs?.askedAt;
  const when = askedAt === undefined ? "" : `asked ${ago(askedAt, context.now)}`;
  const meta = [named ? title : "", named ? when : capitalFirst(when)].filter(Boolean);
  const arm = () => {
    const place = askPlace(task, bot.coordinatorThreadId);
    armAskStrip({ key: `ask:${task.id}`, questionId: task.needs?.questionId, threadId: place.threadId, messageSeq: place.messageSeq, question: task.needs?.question ?? whole, title, options: askOptions(task), botName: bot.name, askedAt, ...(consequence ? { consequence } : {}), ...(recommended ? { recommended } : {}) });
    return place;
  };
  const go = () => { const place = arm(); onNavigate(place.threadId, place.messageSeq); };
  const reply = !!task.needs?.questionId || isQuestionRow(task);
  const label = notNowLabel({ botName: bot.name, title, what: fitWhat(whole, LABEL_CUT), options: task.needs?.options });
  const proceed = () => {
    if (reply) {
      const place = arm();
      requestFill(place.threadId, "");
      onNavigate(place.threadId, place.messageSeq);
      return;
    }
    window.dispatchEvent(new CustomEvent("bb:orchestrator-mode:continue-task", { detail: { threadId: bot.coordinatorThreadId, taskId: task.id, label: title.slice(0, 80) } }));
    onNavigate(bot.coordinatorThreadId);
  };
  return <AskShell itemKey={item.key} current={current} from={from} onOpen={go} spoken={`${title}. ${asked}`} meta={meta}
    question={<FitLines className="panel-ask-fit" forms={oneForms(asked, QUESTION_FORMS, title, options.length)} />}
    foot={<>
      <div className="panel-ask-foot">
        {isQuestionRow(task) ? <span /> : <button type="button" className="panel-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>Details<Icon name="ChevronDown" aria-hidden="true" /></button>}
        <span className="panel-ask-actions">
          <ParkPill parked={false} label={label} itemKey={task.needs?.questionId ?? ""} hint="Move this question to Later" onPark={onPark} />
          <ContinuePill primary label={reply ? "Reply in chat" : "Continue"} name={reply ? `Reply to ${title} in chat` : `Continue ${title}`} hint={reply ? "Write a reply to this question" : "Continue in the bot's chat"} onClick={proceed} />
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
          }}><AnswerLabel label={answer} all={labels} recommended={best} /></button>;
        })}
      </div>
    </div> : null}
  </AskShell>;
}

export function DeskAskCard({ item, botKey, botName, now, current, from = false, onNavigate, onPark }: { item: DeskItem; botKey: string; botName: string; now: number; current: boolean; from?: boolean; onNavigate: Navigate; onPark: Park }) {
  const sdk = useSdk();
  const { desk } = item;
  const [changed, setChanged] = useState(false);
  const [checking, setChecking] = useState(false);
  const [readError, setReadError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { channel, person, subject } = deskParts(desk);
  const { question, about } = deskAsk(desk);
  const messageSeq = desk.question?.messageSeq;
  useEffect(() => { setChanged(false); }, [messageSeq]);
  const draft = desk.threadId && !changed ? desk.question?.draft : undefined;
  const draftKey = JSON.stringify([desk.threadId, messageSeq]);
  const long = !!draft && draft.length > 1200;
  const showFull = !long || expanded === draftKey;
  const options = draft ? (desk.question?.options ?? []).slice(0, ANSWERS_SHOWN) : [];
  const labels = options.map(option => plainNote(option));
  const open = () => { if (desk.threadId) onNavigate(desk.threadId, changed ? undefined : messageSeq); };
  const answer = async (label: string) => {
    if (!desk.threadId || checking || !showFull) return;
    setChecking(true);
    setReadError(false);
    const still = await draftIsCurrent(sdk, botKey, desk.id, messageSeq).catch(() => null);
    setChecking(false);
    if (still === null) { setReadError(true); return; }
    if (!still) { setChanged(true); return; }
    armAskStrip({ key: item.key, questionId: desk.question?.id, threadId: desk.threadId, ...(messageSeq !== undefined ? { messageSeq } : {}), question, title: subject, options, botName, askedAt: desk.updatedAt });
    requestFill(desk.threadId, label, labels, true);
    onNavigate(desk.threadId, messageSeq);
  };
  const label = notNowLabel({ botName, title: subject, what: question });
  const names = (text: string) => !!person && text.includes(person);
  const meta = [names(question) || names(about) ? channel : [channel, person].filter(Boolean).join(" with "), `asked ${ago(desk.updatedAt, now)}`];
  return <AskShell itemKey={item.key} current={current} from={from} onOpen={open} spoken={`${subject}. ${question}`} meta={meta}
    question={<><span className="panel-ask-fit" dir="auto"><Isolated text={question} /></span>{about ? <span className="panel-ask-about" dir="auto"><Isolated text={about} /></span> : null}</>}
    foot={<div className="panel-ask-foot"><span /><span className="panel-ask-actions">
      {desk.question ? <ParkPill parked={false} label={label} itemKey={desk.question.id} hint="Move this desk to Later until it changes" onPark={onPark} /> : null}
      {desk.threadId ? <ContinuePill primary={!labels.length} name={`Continue ${subject}`} hint="Continue in this chat" onClick={open} /> : null}
    </span></div>}>
    {readError ? <p role="status">Couldn’t verify this draft. Try again.</p> : null}
    {changed ? <p className="panel-ask-changed" role="status">This draft changed after it was shown, so nothing was sent. Open the chat to read the latest one.</p> : null}
    {draft ? <blockquote className="panel-ask-draft" dir="auto" aria-label={person ? `The reply to ${person}` : "The reply"}><Isolated text={showFull ? draft : draft.slice(0, 260).trimEnd() + "…"} /></blockquote> : null}
    {long && !showFull ? <button type="button" className="dispatch-option" onClick={() => setExpanded(draftKey)}>Read full draft</button> : null}
    {labels.length && showFull ? <div className="dispatch-options">
      <div className="radar-answers" role="group" aria-label={`Answers to ${subject}`} data-count={labels.length} ref={answerRow}>
        {labels.map(text => <button key={text} type="button" className="dispatch-option radar-answer" aria-label={`Send ${answerName(text, false)} to ${botName}: opens the chat and sends it`} title="Opens the chat and sends this reply" disabled={checking} onClick={() => { void answer(text); }}><AnswerLabel label={text} all={labels} recommended={false} /></button>)}
      </div>
    </div> : null}
  </AskShell>;
}
