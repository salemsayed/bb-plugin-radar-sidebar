import { useEffect, useRef, useState } from "react";
import { botStyle, type RosterBot } from "./bots";
import { openNeeds, type NeedsItem } from "@/lib/needs";
import { dueLabel, snoozedLabel } from "@/lib/reminderTimes";
import type { SwipeActionView } from "@/lib/swipe";
import { useRowSwipe } from "./useRowSwipe";
import { ReminderTimePicker } from "./ReminderTimePicker";

const DONE: SwipeActionView = { id: "done", label: "Done", icon: "Check", removes: false };
const SNOOZE: SwipeActionView = { id: "snooze", label: "Snooze", icon: "Clock", removes: false };
const EMOJI = { decision: "🟡", urgent: "🔴", reminder: "⏰", deadline: "⏰" };
type NeedsAction = "done" | "snooze" | "reopen";
const UNDO_MS = 6_000;

function NeedsRow({ item, roster, now, onUpdate, onOpen }: {
  item: NeedsItem; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [snooze, setSnooze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "done" | "snooze", until?: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onUpdate(item.id, action, until); setSnooze(false); }
    catch { setError("Couldn’t save this change. Try again."); }
    finally { setBusy(false); }
  };
  const reveal = useRowSwipe({ rowRef, enabled: !busy && !snooze, right: DONE, left: SNOOZE, restoreKey: `${item.id}:${item.state}`,
    onCommit: action => { if (action.id === "done") void act("done"); else setSnooze(true); } });
  const bot = roster.find(bot => bot.key === item.bot);
  const name = bot?.name ?? item.bot;
  const due = dueLabel(item.due, now);
  return <li className="radar-needs-item">
    <div ref={rowRef} className="radar-needs-row">
      {reveal?.action ? <div className={`radar-swipe-underlay radar-needs-underlay radar-needs-underlay-${reveal.side}`}>
        <button type="button" disabled={busy} onClick={() => reveal.action?.id === "done" ? void act("done") : setSnooze(true)}>{reveal.action.label}</button>
      </div> : null}
      <div className="radar-needs-summary">
        <span aria-label={item.kind}>{EMOJI[item.kind]}</span>
        <span className="radar-needs-text">{item.text}</span>
        <span className="radar-needs-face" role="img" aria-label={name}>{botStyle(item.bot, name).emoji}</span>
      </div>
      {due ? <span className="radar-needs-due">{due}</span> : null}
      {item.state === "snoozed" && item.snoozeUntil ? <span className="radar-needs-due">{snoozedLabel(item.snoozeUntil)}</span> : null}
      <div className="radar-needs-actions">
        <button type="button" disabled={busy} onClick={() => void act("done")}>Done</button>
        <button type="button" disabled={busy} aria-expanded={snooze} onClick={() => setSnooze(value => !value)}>Snooze</button>
        <button type="button" disabled={!item.source.threadId || busy} onClick={() => item.source.threadId && onOpen(item.source.threadId)}>Open</button>
      </div>
    </div>
    {snooze ? <ReminderTimePicker now={now} busy={busy} onChoose={until => void act("snooze", until)} onCancel={() => setSnooze(false)} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </li>;
}

export function NeedsYouList({ items, roster, now, onUpdate, onOpen }: {
  items: readonly NeedsItem[] | null; roster: readonly RosterBot[]; now: number;
  onUpdate: (id: string, action: NeedsAction, until?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => { setUndo(null); setUndoError(null); }, UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  const update = async (id: string, action: NeedsAction, until?: string) => {
    await onUpdate(id, action, until);
    if (action === "done") {
      setUndo({ id, text: items?.find(item => item.id === id)?.text ?? "Item" });
      setUndoError(null);
    }
  };
  const visible = openNeeds(items ?? []);
  if (!visible.length && !undo) return null;
  return <section className="radar-needs" aria-label="Needs you">
    <h3>Needs you <small>{visible.length} waiting on you</small></h3>
    {undo ? <div className="radar-needs-undo" role="status">
      <span>Done: {undo.text}</span><button type="button" disabled={undoBusy} onClick={() => {
        setUndoBusy(true); setUndoError(null);
        void onUpdate(undo.id, "reopen").then(() => setUndo(null))
          .catch(() => setUndoError("Couldn’t undo. Try again.")).finally(() => setUndoBusy(false));
      }}>Undo</button>
    </div> : null}
    {undoError ? <p role="alert">{undoError}</p> : null}
    <ol>{visible.map(item => <NeedsRow key={item.id} item={item} roster={roster} now={now} onUpdate={update} onOpen={onOpen} />)}</ol>
  </section>;
}
