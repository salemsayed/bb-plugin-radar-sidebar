import { forwardRef } from "react";
import { deskTitle, needsYou, sortDesks, type BotDesk } from "@/lib/botTasks";
import { deskStatus } from "./panel/status";
import { elapsed } from "./elapsed";
import { deskNeedLine } from "./stage";
import { Isolated } from "./Isolated";
import { plainNote } from "./workText";

const CHANNEL_TAG = /^(?:chat|whatsapp|dm|desk|email|ticket chat)\s+·\s+(?=\S)/i;
import { askedAgo } from "./NeedsSummary";

const DAY_MS = 86_400_000;

export function deskHeadline(desks: readonly BotDesk[]): string {
  const need = desks.filter(needsYou).length;
  const working = desks.filter(desk => desk.status === "working").length;
  const waiting = desks.filter(desk => desk.status === "waiting").length;
  const parts = [need ? `${need} need you` : "", working ? `${working} working` : "", waiting ? `${waiting} waiting` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : desks.length ? `${desks.length} open` : "";
}

export const DeskThreads = forwardRef<HTMLElement, { desks: readonly BotDesk[]; now: number; onOpen: (id: string) => void; bare?: boolean }>(function DeskThreads({ desks, now, onOpen, bare = false }, ref) {
  const quiet = (desk: BotDesk) => desk.status === "done" || desk.status === "info";
  const visible = desks.filter(desk => !quiet(desk) || desk.quietSince === null || now - desk.quietSince < DAY_MS);
  const open = sortDesks(visible.filter(desk => desk.status !== "done"));
  const done = sortDesks(visible.filter(desk => desk.status === "done"));
  const row = (desk: BotDesk) => {
    const asking = needsYou(desk);
    const title = asking ? deskNeedLine(desk) : plainNote(deskTitle(desk)).replace(CHANNEL_TAG, "");
    const status = deskStatus(desk, now);
    return <button type="button" key={desk.id} className="radar-desk-row" data-status={desk.status} data-needs-you={asking || undefined}
      disabled={!desk.threadId} onClick={() => desk.threadId && onOpen(desk.threadId)}>
      <span aria-hidden="true" className="radar-desk-mark" data-status={desk.status} />
      <span className="radar-desk-copy"><b dir="auto"><Isolated text={title} /></b>
        {asking ? <small className="radar-desk-asked">{askedAgo(elapsed(desk.updatedAt, now))}</small>
          : <small title={desk.deferredReason ?? undefined}><span className="radar-desk-state">{status.words}</span>{status.note ? ` \u00b7 ${status.note}` : ""}</small>}
      </span>
    </button>;
  };
  if (!visible.length) return null;
  const headline = deskHeadline(open);
  if (bare) return <div className="radar-desks" ref={ref as React.Ref<HTMLDivElement>}>{open.map(row)}</div>;
  return <section className="radar-desks" aria-label="Desks" ref={ref}>
    <header className="dispatch-section-head"><h3>Desks</h3>{headline ? <span data-needs-you={open.some(needsYou) || undefined}>{headline}</span> : null}</header>
    {open.map(row)}
    {done.length ? <details className="radar-desks-done"><summary>{done.length} done in the last 24 h</summary>{done.map(row)}</details> : null}
  </section>;
});
