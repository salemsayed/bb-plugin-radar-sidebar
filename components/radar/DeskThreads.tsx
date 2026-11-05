import { forwardRef } from "react";
import { DESK_MARKS, deskTitle, needsYou, sortDesks, type BotDesk } from "@/lib/botTasks";
import { elapsed } from "./DispatchBoard";

const DAY_MS = 86_400_000;

export function deskHeadline(desks: readonly BotDesk[]): string {
  const need = desks.filter(needsYou).length;
  const working = desks.filter(desk => desk.status === "working").length;
  const parts = [need ? `${need} need you` : "", working ? `${working} working` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : desks.length ? `${desks.length} open` : "";
}

export const DeskThreads = forwardRef<HTMLElement, { desks: readonly BotDesk[]; now: number; onOpen: (id: string) => void }>(function DeskThreads({ desks, now, onOpen }, ref) {
  const quiet = (desk: BotDesk) => desk.status === "done" || desk.status === "info";
  const visible = desks.filter(desk => !quiet(desk) || desk.quietSince === null || now - desk.quietSince < DAY_MS);
  const open = sortDesks(visible.filter(desk => desk.status !== "done"));
  const done = sortDesks(visible.filter(desk => desk.status === "done"));
  const row = (desk: BotDesk) => {
    const title = deskTitle(desk);
    return <button type="button" key={desk.id} className="radar-desk-row" data-status={desk.status} data-needs-you={needsYou(desk) || undefined}
      disabled={!desk.threadId} onClick={() => desk.threadId && onOpen(desk.threadId)}>
      <span aria-hidden="true" className="radar-desk-mark">{DESK_MARKS[desk.status]}</span>
      <span className="radar-desk-copy"><b dir="auto">{title}</b>{desk.status === "deferred" ? <small title={desk.deferredReason ?? undefined}>Waiting for capacity{desk.deadline !== null ? ` · deadline ${new Date(desk.deadline).toLocaleString()}` : ""}</small> : null}</span>
      <small>{elapsed(desk.updatedAt, now)}</small>
    </button>;
  };
  if (!visible.length) return null;
  const headline = deskHeadline(open);
  return <section className="radar-desks" aria-label="Desks" ref={ref}>
    <header className="dispatch-section-head"><h3>Desks</h3>{headline ? <span data-needs-you={open.some(needsYou) || undefined}>{headline}</span> : null}</header>
    {open.map(row)}
    {done.length ? <details className="radar-desks-done"><summary>✅ {done.length} done today</summary>{done.map(row)}<p>Hidden after 24 quiet hours</p></details> : null}
  </section>;
});
