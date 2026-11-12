import { useMemo, useState } from "react";
import { isClosed, type Attempt } from "@/lib/botTasks";
import { Isolated } from "../Isolated";
import { capitalFirst, datedHead, mergeRequestWords, workerNames } from "../workText";
import type { TaskItem } from "./panelModel";
import { quoteShown, taskDetail, type DetailContext } from "./taskDetail";
import { attemptStatus, dayAndTime } from "./taskWords";

const WORKERS_SHOWN = 5;

function foldWords(attempts: readonly Attempt[], earlier: boolean): string {
  const states = new Map<string, number>();
  for (const attempt of attempts) { const state = attempt.state === "unknown" ? "idle" : attempt.state; states.set(state, (states.get(state) ?? 0) + 1); }
  const noun = `${attempts.length} ${earlier ? "earlier " : ""}${attempts.length === 1 ? "worker" : "workers"}`;
  if (states.size === 1) { const [state] = states.keys(); return `${noun}, ${attempts.length === 1 ? "" : "all "}${state}`; }
  return `${noun}: ${[...states].map(([state, count]) => `${count} ${state}`).join(", ")}`;
}

function WorkerList({ attempts, now, onOpen }: { attempts: readonly Attempt[]; now: number; onOpen: (threadId: string) => void }) {
  const [all, setAll] = useState(false);
  const names = useMemo(() => workerNames(attempts), [attempts]);
  const running = attempts.filter(attempt => attempt.state === "running");
  const rest = attempts.filter(attempt => attempt.state !== "running");
  const fold = attempts.length > WORKERS_SHOWN;
  const shown = fold && !all ? running : [...running, ...rest];
  return <ul className="panel-workers">
    {shown.map(attempt => {
      const status = attemptStatus(attempt, now);
      const name = names.get(attempt.threadId) ?? "Worker";
      return <li key={attempt.threadId}><button type="button" className="panel-worker" onClick={() => onOpen(attempt.threadId)} aria-label={`Open worker ${name}${status ? `, ${status}` : ""}`}>
        <i className="panel-mark" data-mark={attempt.state === "running" ? "working" : "waiting"} aria-hidden="true" />
        <span className="panel-worker-name" dir="auto"><Isolated text={name} /></span>
        {status ? <span className="panel-worker-status">{capitalFirst(status)}</span> : null}
      </button></li>;
    })}
    {fold ? <li><button type="button" className="panel-worker-fold" aria-expanded={all} onClick={() => setAll(value => !value)}>
      <span>{all ? foldWords(attempts, false) : foldWords(rest, running.length > 0)}</span><b>{all ? "Hide" : "Show"}</b>
    </button></li> : null}
  </ul>;
}

function Fact({ label, text }: { label: string; text: string }) {
  return <p className="panel-fact" dir="auto"><span>{label}</span><Isolated text={text} /></p>;
}

export function TaskDetails({ item, context, onOpen }: { item: TaskItem; context: DetailContext; onOpen: (threadId: string) => void }) {
  const detail = taskDetail(item, context);
  const { task, attempts } = item;
  const elsewhere = !isClosed(task.displayState) && task.conversationThreadId && !attempts.some(attempt => attempt.threadId === task.conversationThreadId) ? task.conversationThreadId : null;
  const empty = !detail.ask && !detail.goal && !detail.soFar && !detail.botNote && !detail.standing && !detail.latest && !attempts.length && !task.ask && !elsewhere;
  if (empty) return <p className="panel-fact panel-fact-empty">Nothing more recorded for this one.</p>;
  return <>
    {detail.soFar ? <Fact label="Done so far" text={detail.soFar} /> : null}
    {detail.latest ? <Fact label="Latest note" text={detail.latest} /> : null}
    {detail.botNote ? <Fact label={`From the bot, ${dayAndTime(detail.botNote.at, context.now)}`} text={`“${detail.botNote.text}”`} /> : null}
    {detail.ask ? <Fact label={datedHead(detail.ask.head)} text={detail.ask.full || detail.ask.quote ? `“${mergeRequestWords(quoteShown(detail.ask.full || detail.ask.quote, detail.ask.excerpt))}”` : ""} /> : null}
    {detail.standing ? <Fact label="Your standing instruction" text={`“${detail.standing}”`} /> : null}
    {detail.goal ? <Fact label="Goal" text={detail.goal} /> : null}
    {attempts.length ? <WorkerList attempts={attempts} now={context.now} onOpen={onOpen} /> : null}
    <div className="panel-links">
      {task.ask ? <button type="button" className="panel-link" onClick={() => onOpen(task.ask!.ref.threadId)}>{detail.ask?.excerpt ? "Read the whole message in chat" : "Open where you asked"}</button> : null}
      {elsewhere ? <button type="button" className="panel-link" onClick={() => onOpen(elsewhere)}>Open its thread</button> : null}
    </div>
  </>;
}
