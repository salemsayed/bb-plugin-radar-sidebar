import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { HugeiconsIcon } from "@hugeicons/react";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import { BotFace } from "./BotFace";
import { shortBotName, type RosterBot } from "./bots";
import { openNeeds, type NeedsItem } from "@/lib/needs";
import { CAIRO, cairoLocal, dueLabel, snoozedLabel } from "@/lib/reminderTimes";
import { shortAgo } from "./time";
import type { SwipeActionView } from "@/lib/swipe";
import { useRowSwipe } from "./useRowSwipe";
import { ReminderTimePicker } from "./ReminderTimePicker";

const DONE: SwipeActionView = { id: "done", label: "Done", icon: "Check", removes: false };
const SNOOZE: SwipeActionView = { id: "snooze", label: "Snooze", icon: "Clock", removes: false };
const KIND = { decision: "Decision", urgent: "Urgent", reminder: "Reminder", deadline: "Deadline" };
type NeedsAction = "done" | "snooze" | "reopen";
const UNDO_MS = 6_000;
type Completion = { item: NeedsItem; position: number; expiresAt: number; busy: boolean; error: boolean };

function NeedsRow({ item, roster, now, onUpdate, onOpen }: {
  item: NeedsItem; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [snooze, setSnooze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<{ action: "done" | "snooze"; until?: string } | null>(null);
  const act = async (action: "done" | "snooze", until?: string) => {
    if (busy) return;
    setBusy(true); setRetry(null);
    try { await onUpdate(item.id, action, until); setSnooze(false); }
    catch { setRetry({ action, until }); }
    finally { setBusy(false); }
  };
  const reveal = useRowSwipe({ rowRef, enabled: !busy && !snooze, right: DONE, left: SNOOZE, restoreKey: `${item.id}:${item.state}`,
    onCommit: action => { if (action.id === "done") void act("done"); else setSnooze(true); } });
  const bot = roster.find(bot => bot.key === item.bot);
  const name = shortBotName(bot?.name ?? item.bot);
  const due = dueLabel(item.due, now);
  const dueDay = item.due ? (/(Z|[+-]\d{2}:\d{2})$/.test(item.due) ? cairoLocal(Date.parse(item.due)).slice(0, 10) : item.due.slice(0, 10)) : null;
  const overdue = !!dueDay && dueDay < cairoLocal(now).slice(0, 10);
  const tone = item.kind === "urgent" || overdue ? "urgent" : item.kind === "decision" || item.kind === "deadline" ? "decision" : "reminder";
  const text = <span className="radar-needs-text">{item.text}</span>;
  return <li className={`radar-needs-item radar-needs-${tone}${item.state === "snoozed" ? " radar-needs-is-snoozed" : ""}`}>
    <div ref={rowRef} className="radar-needs-row" aria-busy={busy}>
      {reveal?.action ? <div className={`radar-swipe-underlay radar-needs-underlay radar-needs-underlay-${reveal.side}`}>
        <button type="button" disabled={busy} onClick={() => reveal.action?.id === "done" ? void act("done") : setSnooze(true)}>{reveal.action.label}</button>
      </div> : null}
      <button className="radar-needs-check" type="button" aria-label={`Mark done: ${item.text}`} title="Mark done" disabled={busy} onClick={() => void act("done")}>
        <span><Icon name="Check" /></span>
      </button>
      <div className="radar-needs-body">
        {item.source.threadId ? <button type="button" className="radar-needs-open" disabled={busy} onClick={() => onOpen(item.source.threadId!)} aria-label={`Open: ${item.text}`}>{text}</button> : <div className="radar-needs-plain">{text}</div>}
        <div className={`radar-needs-meta${due ? " radar-needs-meta-has-due" : ""}`}>
          <span className="radar-needs-who"><BotFace botKey={item.bot} name={name} size={14} /> <span className="radar-needs-who-name">{name}</span></span>
          <span className={due ? `radar-needs-due${overdue ? " radar-needs-overdue" : ""}` : "radar-needs-age"}>
            {item.state === "snoozed" ? "Snoozed" : due ? `${overdue ? "Overdue" : "Due"} ${due}` : shortAgo(Date.parse(item.createdAt), now)}
          </span>
          <span className="radar-needs-kind">{KIND[item.kind]}</span>
          <button className="radar-needs-snooze" type="button" disabled={busy} aria-label={`Snooze: ${item.text}`} title="Snooze" aria-expanded={snooze} onClick={() => setSnooze(value => !value)}><HugeiconsIcon icon={Clock01Icon} aria-hidden="true" /></button>
        </div>
        {item.state === "snoozed" && item.snoozeUntil ? <span className="radar-needs-snoozed-until">{snoozedLabel(item.snoozeUntil)}</span> : null}
      </div>
    </div>
    {snooze ? <ReminderTimePicker now={now} busy={busy} onChoose={until => void act("snooze", until)} onCancel={() => setSnooze(false)} /> : null}
    {retry ? <div className="radar-needs-error" role="alert"><span>Couldn’t save this change.</span><button type="button" disabled={busy} onClick={() => void act(retry.action, retry.until)}>Retry</button></div> : null}
  </li>;
}

export function NeedsYouList({ items, roster, now, onUpdate, onOpen }: {
  items: readonly NeedsItem[] | null; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const [completed, setCompleted] = useState<Completion[]>([]);
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  useEffect(() => {
    const expiring = completed.filter(item => !item.busy && !item.error);
    if (!expiring.length) return;
    const timer = setTimeout(() => setCompleted(previous => previous.filter(item => item.busy || item.error || item.expiresAt > Date.now())),
      Math.max(0, Math.min(...expiring.map(item => item.expiresAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [completed]);
  const update = async (id: string, action: NeedsAction, until?: string) => {
    const item = items?.find(item => item.id === id);
    const position = ordered.findIndex(item => item.id === id);
    await onUpdate(id, action, until);
    if (action === "done" && item) setCompleted(previous => [...previous.filter(done => done.item.id !== id), { item, position: Math.max(0, position), expiresAt: Date.now() + UNDO_MS, busy: false, error: false }]);
  };
  const undo = async (id: string) => {
    setCompleted(previous => previous.map(done => done.item.id === id ? { ...done, busy: true, error: false } : done));
    try {
      await onUpdate(id, "reopen");
      setCompleted(previous => previous.filter(done => done.item.id !== id));
    } catch {
      setCompleted(previous => previous.map(done => done.item.id === id ? { ...done, busy: false, error: true } : done));
    }
  };
  const visible = openNeeds(items ?? []).filter(item => !completed.some(done => done.item.id === item.id));
  const snoozed = visible.filter(item => item.state === "snoozed").sort((a, b) => (a.snoozeUntil ?? "").localeCompare(b.snoozeUntil ?? ""));
  const waiting = visible.filter(item => item.state !== "snoozed");
  const ordered = [...waiting];
  for (const done of [...completed].sort((a, b) => a.position - b.position)) ordered.splice(Math.min(done.position, ordered.length), 0, done.item);
  if (!visible.length && !completed.length) return null;
  const render = (item: NeedsItem) => {
    const done = completed.find(done => done.item.id === item.id);
    return done ? <li key={item.id} className="radar-needs-undo" role="status">
      <Icon name="Check" /><span>Done: {done.item.text}</span><button type="button" disabled={done.busy} onClick={() => void undo(item.id)}>Undo</button>
      {done.error ? <p role="alert">Couldn’t undo. Try again.</p> : <span key={done.expiresAt} className="radar-needs-undo-progress" aria-hidden="true" />}
    </li> : <NeedsRow key={item.id} item={item} roster={roster} now={now} onUpdate={update} onOpen={onOpen} />;
  };
  return <section className="radar-needs" aria-label="Needs you">
    <h3>Needs you <small><b>{waiting.length}</b>{snoozed.length ? ` · ${snoozed.length} snoozed` : ""}</small></h3>
    <ol>{ordered.map(render)}</ol>
    {snoozed.length ? <>
      <button className="radar-needs-snoozed-toggle" type="button" aria-expanded={snoozedOpen} onClick={() => setSnoozedOpen(value => !value)}>
        <HugeiconsIcon icon={Clock01Icon} aria-hidden="true" /><span>{snoozed.length} snoozed{snoozed[0]?.snoozeUntil ? ` · ${`next ${new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(snoozed[0].snoozeUntil)).replace(",", "")}`}` : ""}</span><Icon name="ChevronDown" />
      </button>
      {snoozedOpen ? <ol aria-label="Snoozed asks">{snoozed.map(render)}</ol> : null}
    </> : null}
  </section>;
}
