import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import { shortBotName, type RosterBot } from "./bots";
import type { PlateAction, PlateItem, PlateMode } from "@/lib/plate";
import { CAIRO, cairoLocal } from "@/lib/reminderTimes";

/** At most this many of a bot's items closed today show under "Done today". */
export const DONE_TODAY_MAX = 8;
const LAST_WORD_CHARS = 80;
const RANK: Record<PlateItem["state"], number> = { stalled: 0, waiting: 1, running: 2, open: 3, done: 4, dropped: 5 };
const ACTIVE = new Set<PlateItem["state"]>(["stalled", "waiting", "running", "open"]);

/** Same wording as the plate's own age (bb-plugin-saelmbot plate.ts). */
export function plateAge(ms: number, now: number): string {
  const h = Math.max(0, Math.floor((now - ms) / 3600_000));
  return h < 1 ? "just now" : h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}
const truncate = (text: string, max: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat; };
const ownerLabel = (owner: string) => owner.toLowerCase() === "salem" ? "on you" : `on ${owner}`;
const onSalem = (item: PlateItem) => item.state === "waiting" && item.owner?.toLowerCase() === "salem";

type BotPlate = { key: string; name: string; active: PlateItem[]; doneToday: PlateItem[] };

/** Bots whose plate is on, in roster order, each with its rows ordered stalled → waiting → running → open and today's done ones. */
export function plateSections(items: readonly PlateItem[], modes: Readonly<Record<string, PlateMode>>, roster: readonly RosterBot[], now: number, bot?: string | null): BotPlate[] {
  const today = cairoLocal(now).slice(0, 10);
  const keys = [...roster.map(entry => entry.key), ...Object.keys(modes).filter(key => !roster.some(entry => entry.key === key)).sort()];
  return keys.filter(key => modes[key] === "on" && (!bot || key === bot)).map(key => {
    const own = items.filter(item => item.bot === key);
    const active = own.filter(item => ACTIVE.has(item.state))
      .sort((a, b) => RANK[a.state] - RANK[b.state] || a.progressAt.localeCompare(b.progressAt));
    const doneToday = own.filter(item => item.state === "done" && item.closedAt && cairoLocal(Date.parse(item.closedAt)).slice(0, 10) === today)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")).slice(0, DONE_TODAY_MAX);
    return { key, name: shortBotName(roster.find(entry => entry.key === key)?.name ?? key), active, doneToday };
  }).filter(section => section.active.length || section.doneToday.length);
}

export function plateSummary(active: readonly PlateItem[]): string {
  const stalled = active.filter(item => item.state === "stalled").length;
  const onYou = active.filter(onSalem).length;
  return [active.length ? `${active.length} in flight` : "", onYou ? `${onYou} on you` : "", stalled ? `${stalled} stalled` : ""].filter(Boolean).join(" · ");
}

function StateIcon({ state }: { state: PlateItem["state"] }) {
  const label = state === "done" ? "Done" : state[0]!.toUpperCase() + state.slice(1);
  return <span className={`radar-plate-icon radar-plate-icon-${state}`} role="img" aria-label={label} title={label}>
    {state === "stalled" ? <Icon name="AlertTriangle" aria-hidden="true" />
      : state === "waiting" ? <HugeiconsIcon icon={Clock01Icon} aria-hidden="true" />
      : state === "running" ? <span className="radar-spinner"><Icon name="Loading" aria-hidden="true" /></span>
      : state === "done" ? <Icon name="Check" aria-hidden="true" />
      : <Icon name="Circle" aria-hidden="true" />}
  </span>;
}

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function PlateRow({ item, now, onUpdate, onOpen }: {
  item: PlateItem; now: number;
  onUpdate: (id: string, action: PlateAction, evidence?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const act = async (action: PlateAction, proof?: string) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await onUpdate(item.id, action, proof); setEvidence(null); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); const proof = evidence?.trim(); if (proof) void act("done", proof); };
  const meta = [plateAge(Date.parse(item.progressAt), now), item.state === "waiting" && item.owner ? ownerLabel(item.owner) : "", item.workerTitle ?? "",
    item.lastWord && !expanded ? truncate(item.lastWord, LAST_WORD_CHARS) : ""].filter(Boolean);
  const active = ACTIVE.has(item.state);
  return <li className={`radar-plate-item radar-plate-${item.state}`} data-plate-id={item.id}>
    <StateIcon state={item.state} />
    <div className="radar-plate-body">
      <button type="button" className="radar-plate-open" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span className="radar-plate-text">“{item.text}”</span>
      </button>
      <div className="radar-plate-meta">{meta.map((part, index) => <span key={index}>{part}</span>)}</div>
      {expanded ? <div className="radar-plate-detail">
        {item.lastWord ? <p className="radar-plate-last">{item.lastWord}</p> : null}
        {item.evidence ? <p className="radar-plate-evidence">Evidence: {item.evidence}</p> : null}
        <p className="radar-plate-created">Asked {when(item.createdAt)}{item.via === "chatgpt" ? " via ChatGPT" : ""}</p>
        <div className="radar-plate-actions">
          {item.workerThread ? <button type="button" className="radar-plate-action" onClick={() => onOpen(item.workerThread!)}>Open worker</button> : null}
          <button type="button" className="radar-plate-action" onClick={() => onOpen(item.sourceThread)}>Open chat</button>
          {active ? <>
            <button type="button" className="radar-plate-action" disabled={busy} aria-expanded={evidence !== null} onClick={() => setEvidence(value => value === null ? "" : null)}>Done</button>
            <button type="button" className="radar-plate-action" disabled={busy} onClick={() => void act("drop")}>Drop</button>
          </> : null}
        </div>
        {evidence !== null ? <form className="radar-plate-evidence-form" onSubmit={submit}>
          <input aria-label="What shows it is done?" placeholder="What shows it is done?" maxLength={500} autoFocus value={evidence} disabled={busy} onChange={event => setEvidence(event.target.value)} />
          <button type="submit" className="radar-plate-action" disabled={busy || !evidence.trim()}>Save</button>
        </form> : null}
        {error ? <p role="alert">Couldn’t save this change.</p> : null}
      </div> : null}
    </div>
  </li>;
}

function BotSection({ section, now, startOpen, onUpdate, onOpen }: {
  section: BotPlate; now: number; startOpen: boolean;
  onUpdate: (id: string, action: PlateAction, evidence?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [doneOpen, setDoneOpen] = useState(false);
  const summary = plateSummary(section.active);
  return <section className="radar-plate-bot" aria-label={`${section.name} plate`}>
    <button type="button" className="radar-plate-bot-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden="true" />
      <span>{section.name}{summary ? ` · ${summary}` : ""}</span>
    </button>
    {open ? <>
      {section.active.length ? <ol>{section.active.map(item => <PlateRow key={item.id} item={item} now={now} onUpdate={onUpdate} onOpen={onOpen} />)}</ol> : null}
      {section.doneToday.length ? <>
        <button type="button" className="radar-plate-done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen(value => !value)}>
          <Icon name="Check" aria-hidden="true" /><span>Done today · {section.doneToday.length}</span>
        </button>
        {doneOpen ? <ol aria-label={`${section.name} done today`}>{section.doneToday.map(item => <PlateRow key={item.id} item={item} now={now} onUpdate={onUpdate} onOpen={onOpen} />)}</ol> : null}
      </> : null}
    </> : null}
  </section>;
}

/**
 * The Plate lane: what Salem asked each bot for that has not come back
 * finished, folded to "Plate · N" like Needs you, one folded section per bot
 * whose plate is on. Gone when nothing is on any plate.
 */
export function PlateLane({ items, modes, roster, now, bot, open, onToggle, onUpdate, onOpen }: {
  items: readonly PlateItem[] | null; modes: Readonly<Record<string, PlateMode>>; roster: readonly RosterBot[]; now: number;
  /** A bot's own view shows only that bot's section. */
  bot?: string | null;
  open: boolean; onToggle: () => void;
  onUpdate: (id: string, action: PlateAction, evidence?: string) => Promise<void>;
  onOpen: (threadId: string) => void;
}) {
  const sections = plateSections(items ?? [], modes, roster, now, bot);
  if (!sections.length) return null;
  const total = sections.reduce((sum, section) => sum + section.active.length, 0);
  return <section aria-label="Plate" className={cn("radar-group radar-group-plate radar-plate", open ? "radar-group-expanded" : "radar-group-collapsed")}>
    <div className="radar-group-header">
      <button type="button" className="radar-group-toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden="true" className="radar-group-chevron" />
        <span className="radar-group-label">Plate</span>
        <span className="radar-plate-fold-count"> · {total}</span>
      </button>
    </div>
    {open ? <div className="radar-plate-lane">
      {sections.map(section => <BotSection key={section.key} section={section} now={now} startOpen={sections.length === 1} onUpdate={onUpdate} onOpen={onOpen} />)}
    </div> : null}
  </section>;
}
