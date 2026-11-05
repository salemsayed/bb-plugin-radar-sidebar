import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import { BotFace } from "./BotFace";
import { shortBotName, type RosterBot } from "./bots";
import { openNeeds, type NeedsItem } from "@/lib/needs";
import { CAIRO, cairoLocal, dueLabel, reminderChoices, snoozedLabel } from "@/lib/reminderTimes";
import { shortAgo } from "./time";
import type { SwipeActionView } from "@/lib/swipe";
import { useRowSwipe } from "./useRowSwipe";
import { ReminderTimePicker } from "./ReminderTimePicker";

const DONE: SwipeActionView = { id: "done", label: "Done", icon: "Check", removes: false };
const SNOOZE: SwipeActionView = { id: "snooze", label: "Snooze", icon: "Clock", removes: false };
const SEEN: SwipeActionView = { id: "done", label: "Seen", icon: "Check", removes: false };
const KIND: Record<NeedsItem["kind"], string> = { decision: "Decision", urgent: "Urgent", reminder: "Reminder", deadline: "Deadline", alert: "Alert" };
/** The recommendation button shows about this much of the bot's suggested answer. */
const RECOMMEND_CHARS = 24;
type NeedsAction = "done" | "snooze" | "reopen";
export function recommendLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > RECOMMEND_CHARS ? `${flat.slice(0, RECOMMEND_CHARS - 1).trimEnd()}…` : flat;
}
const UNDO_MS = 6_000;
type Completion = { item: NeedsItem; position: number; expiresAt: number; busy: boolean; error: boolean; later?: boolean };
export function notNowUntil(now: number): string {
  return reminderChoices(now)[1]!.until;
}

function NeedsRow({ item, roster, now, onUpdate, onOpen, onReply, onNotNow }: {
  item: NeedsItem; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onNotNow: (id: string) => Promise<void>;
  onOpen: (threadId: string) => void;
  onReply?: (threadId: string, text: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [snooze, setSnooze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<{ action: "done" | "snooze" | "later"; until?: string } | null>(null);
  const act = async (action: "done" | "snooze" | "later", until?: string) => {
    if (busy) return;
    setBusy(true); setRetry(null);
    try { if (action === "later") await onNotNow(item.id); else await onUpdate(item.id, action, until); setSnooze(false); }
    catch { setRetry({ action, until }); }
    finally { setBusy(false); }
  };
  const alert = item.kind === "alert";
  // An alert is closed by seeing it; the same update as Done, named for what it means.
  const reveal = useRowSwipe({ rowRef, enabled: !busy && !snooze, right: alert ? SEEN : DONE, left: SNOOZE, restoreKey: `${item.id}:${item.state}`,
    onCommit: action => { if (action.id === "done") void act("done"); else setSnooze(true); } });
  const bot = roster.find(bot => bot.key === item.bot);
  const recommend = typeof item.recommend === "string" && item.recommend.trim() ? item.recommend.trim() : null;
  // A recommendation answers in the item's thread, else the bot's current coordinator.
  const replyThread = item.source.threadId ?? bot?.current ?? null;
  const reply = () => { if (!replyThread || !recommend) return; if (onReply) onReply(replyThread, recommend); else onOpen(replyThread); };

  const name = shortBotName(bot?.name ?? item.bot);
  const due = dueLabel(item.due, now);
  const dueDay = item.due ? (/(Z|[+-]\d{2}:\d{2})$/.test(item.due) ? cairoLocal(Date.parse(item.due)).slice(0, 10) : item.due.slice(0, 10)) : null;
  const overdue = !!dueDay && dueDay < cairoLocal(now).slice(0, 10);
  const tone = item.kind === "urgent" || overdue ? "urgent" : item.kind === "decision" || item.kind === "deadline" ? "decision" : alert ? "alert" : "reminder";
  const text = <span className="radar-needs-text">{item.text}</span>;
  return <li className={`radar-needs-item radar-needs-${tone}${item.state === "snoozed" ? " radar-needs-is-snoozed" : ""}`}>
    <div ref={rowRef} className="radar-needs-row" aria-busy={busy}>
      {reveal?.action ? <div className={`radar-swipe-underlay radar-needs-underlay radar-needs-underlay-${reveal.side}`}>
        <button type="button" disabled={busy} onClick={() => reveal.action?.id === "done" ? void act("done") : setSnooze(true)}>{reveal.action.label}</button>
      </div> : null}
      {/* An alert leads with its badge and closes through its Seen button or a swipe; its Open sits in the action row. */}
      {alert ? <span className="radar-needs-badge radar-needs-badge-alert" aria-hidden="true" title="Alert"><Icon name="AlertCircle" /></span>
        : <button className="radar-needs-check" type="button" aria-label={`Mark done: ${item.text}`} title="Mark done" disabled={busy} onClick={() => void act("done")}>
          <span><Icon name="Check" /></span>
        </button>}
      <div className="radar-needs-body">
        {item.source.threadId && !alert ? <button type="button" className="radar-needs-open" disabled={busy} onClick={() => onOpen(item.source.threadId!)} aria-label={`Open: ${item.text}`}>{text}</button> : <div className="radar-needs-plain">{text}</div>}
        <div className={`radar-needs-meta${due ? " radar-needs-meta-has-due" : ""}`}>
          <span className="radar-needs-who"><BotFace botKey={item.bot} name={name} size={14} /> <span className="radar-needs-who-name">{name}</span></span>
          <span className={due ? `radar-needs-due${overdue ? " radar-needs-overdue" : ""}` : "radar-needs-age"}>
            {item.state === "snoozed" ? "Snoozed" : due ? `${overdue ? "Overdue" : "Due"} ${due}` : shortAgo(Date.parse(item.createdAt), now)}
          </span>
          <span className={cn("radar-needs-kind", alert && "radar-needs-kind-alert")}>{KIND[item.kind]}</span>
          <button className="radar-needs-snooze" type="button" disabled={busy} aria-label={`Snooze: ${item.text}`} title="Snooze" aria-expanded={snooze} onClick={() => setSnooze(value => !value)}><HugeiconsIcon icon={Clock01Icon} aria-hidden="true" /></button>
        </div>
        {item.state === "snoozed" && item.snoozeUntil ? <span className="radar-needs-snoozed-until">{snoozedLabel(item.snoozeUntil)}</span> : null}
        {recommend || alert || item.state !== "snoozed" ? <div className="radar-needs-actions">
          {recommend && replyThread ? <button type="button" className="radar-needs-action radar-needs-action-primary" disabled={busy} title={`Reply: ${recommend}`} aria-label={`Reply: ${recommend}`} onClick={reply}>{recommendLabel(recommend)}</button> : null}
          {item.state !== "snoozed" ? <button type="button" className="radar-needs-action" disabled={busy} title="Not now: snooze until tomorrow 09:00" aria-label={`Not now: ${item.text}`} onClick={() => void act("later")}>Not now</button> : null}
          {alert ? <>
            <button type="button" className="radar-needs-action" disabled={busy} aria-label={`Seen: ${item.text}`} onClick={() => void act("done")}>Seen</button>
            {item.source.threadId ? <button type="button" className="radar-needs-action" disabled={busy} aria-label={`Open: ${item.text}`} onClick={() => onOpen(item.source.threadId!)}>Open</button> : null}
          </> : null}
        </div> : null}
      </div>
    </div>
    {snooze ? <ReminderTimePicker now={now} busy={busy} onChoose={until => void act("snooze", until)} onCancel={() => setSnooze(false)} /> : null}
    {retry ? <div className="radar-needs-error" role="alert"><span>Couldn’t save this change.</span><button type="button" disabled={busy} onClick={() => void act(retry.action, retry.until)}>Retry</button></div> : null}
  </li>;
}

export function NeedsYouList({ items, roster, now, onUpdate, onOpen, onReply, heading = true, className }: {
  items: readonly NeedsItem[] | null; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
  /** Opens a thread with the recommendation as its draft reply; without it the thread just opens. */
  onReply?: (threadId: string, text: string) => void;
  /** Off when the list sits under a group header that already says "Needs you". */
  heading?: boolean;
  className?: string;
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
  const later = async (id: string) => {
    const item = items?.find(item => item.id === id);
    const position = ordered.findIndex(item => item.id === id);
    await onUpdate(id, "snooze", notNowUntil(Date.now()));
    if (item) setCompleted(previous => [...previous.filter(done => done.item.id !== id), { item, position: Math.max(0, position), expiresAt: Date.now() + UNDO_MS, busy: false, error: false, later: true }]);
  };
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
      <Icon name={done.later ? "Clock" : "Check"} /><span>{done.later ? "Later (tomorrow 09:00)" : "Done"}: {done.item.text}</span><button type="button" disabled={done.busy} onClick={() => void undo(item.id)}>Undo</button>
      {done.error ? <p role="alert">Couldn’t undo. Try again.</p> : <span key={done.expiresAt} className="radar-needs-undo-progress" aria-hidden="true" />}
    </li> : <NeedsRow key={item.id} item={item} roster={roster} now={now} onUpdate={update} onNotNow={later} onOpen={onOpen} onReply={onReply} />;
  };
  return <section className={cn("radar-needs", className)} aria-label="Needs you">
    {heading ? <h3>Needs you <small><b>{waiting.length}</b>{snoozed.length ? ` · ${snoozed.length} snoozed` : ""}</small></h3> : null}
    <ol>{ordered.map(render)}</ol>
    {snoozed.length ? <>
      <button className="radar-needs-snoozed-toggle" type="button" aria-expanded={snoozedOpen} onClick={() => setSnoozedOpen(value => !value)}>
        <HugeiconsIcon icon={Clock01Icon} aria-hidden="true" /><span>{snoozed.length} snoozed{snoozed[0]?.snoozeUntil ? ` · ${`next ${new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(snoozed[0].snoozeUntil)).replace(",", "")}`}` : ""}</span><Icon name="ChevronDown" />
      </button>
      {snoozedOpen ? <ol aria-label="Snoozed asks">{snoozed.map(render)}</ol> : null}
    </> : null}
  </section>;
}

/**
 * The one Needs-you lane, folded to "Needs you · N" (open items plus the
 * threads waiting on you) in every view, and gone at zero. Opening it shows
 * the saved asks and alerts first, then the waiting threads.
 */
export function NeedsYouLane({ items, waitingCount, waiting, open, onToggle, ...list }: {
  items: readonly NeedsItem[]; roster: readonly RosterBot[]; now: number;
  /** Waiting threads under the asks, and how many of them there are. */
  waitingCount: number; waiting?: ReactNode;
  open: boolean; onToggle: () => void;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
  onReply?: (threadId: string, text: string) => void;
}) {
  const count = openNeeds(items).length + waitingCount;
  if (count === 0) return null;
  return <section aria-label="Needs you"
    className={cn("radar-group radar-group-needs-you radar-needs-fold", open ? "radar-group-expanded" : "radar-group-collapsed")}>
    <div className="radar-group-header">
      <button type="button" className="radar-group-toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden="true" className="radar-group-chevron" />
        <span className="radar-group-label">Needs you</span>
        <span className="radar-needs-fold-count"> · {count}</span>
      </button>
    </div>
    {open ? <>
      <NeedsYouList items={items} heading={false} className="radar-needs-lane" {...list} />
      {waiting}
    </> : null}
  </section>;
}
