import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { WorkItem } from "./panelModel";
import { GROUP_TITLE } from "./status";

const TODAY_SHOWN = 3;
const DAY_MS = 86_400_000;
const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "short" });

function dayLabel(at: number, now: number): string {
  const start = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  return Math.round((start(now) - start(at)) / DAY_MS) === 1 ? "Yesterday" : dayName.format(new Date(at));
}

function byDay(items: readonly WorkItem[], now: number): { label: string; items: WorkItem[] }[] {
  const days: { label: string; items: WorkItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

function foldLabel(moreToday: number, earlier: number): string {
  if (moreToday && earlier) return `${moreToday} more today, ${earlier} earlier this week`;
  return moreToday ? `${moreToday} more today` : `${earlier} earlier this week`;
}

export function DoneSection({ today, earlier, now, renderRows }: { today: readonly WorkItem[]; earlier: readonly WorkItem[]; now: number; renderRows: (items: readonly WorkItem[]) => ReactNode }) {
  const [all, setAll] = useState(false);
  if (!today.length && !earlier.length) return null;
  const moreToday = Math.max(0, today.length - TODAY_SHOWN);
  const folded = moreToday + earlier.length;
  return <section className="panel-section" data-group="done" aria-label={GROUP_TITLE.done}>
    <header className="panel-section-head"><h3>{GROUP_TITLE.done}</h3>{today.length ? <span>{today.length} today</span> : null}</header>
    {today.length ? renderRows(all ? today : today.slice(0, TODAY_SHOWN)) : null}
    {all ? byDay(earlier, now).map(day => <div key={day.label} className="panel-day"><h4>{day.label}</h4>{renderRows(day.items)}</div>) : null}
    {folded ? <button type="button" className="panel-fold" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? "Show less" : foldLabel(moreToday, earlier.length)}<Icon name="ChevronDown" aria-hidden="true" /></button> : null}
  </section>;
}
