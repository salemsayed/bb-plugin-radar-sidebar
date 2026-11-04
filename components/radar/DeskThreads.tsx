import type { BotDesk } from "@/lib/botTasks";
import { elapsed } from "./DispatchBoard";

const marks = { draft: "🟢", blocked: "🟠", working: "⏳", info: "⚪", done: "✅", deferred: "⏸" };
export function DeskThreads({ desks, now, onOpen }: { desks: readonly BotDesk[]; now: number; onOpen: (id: string) => void }) {
  const finished = (desk: BotDesk) => desk.status === "done" || desk.status === "info";
  const visible = desks.filter(desk => !finished(desk) || desk.quietSince === null || now - desk.quietSince < 86_400_000);
  const open = visible.filter(desk => !finished(desk));
  const done = visible.filter(finished);
  const row = (desk: BotDesk) => <button type="button" key={desk.id} className="radar-desk-row" disabled={!desk.threadId} onClick={() => desk.threadId && onOpen(desk.threadId)}>
    <span aria-hidden="true">{marks[desk.status]}</span><span className="radar-desk-copy"><b dir="auto">{desk.label} · {desk.title}</b>{desk.status === "deferred" ? <small title={desk.deferredReason ?? undefined}>Waiting for capacity{desk.deadline !== null ? ` · deadline ${new Date(desk.deadline).toLocaleString()}` : ""}</small> : null}</span><small>{elapsed(desk.updatedAt, now)}</small>
  </button>;
  if (!visible.length) return null;
  return <section className="radar-desks" aria-label="Desks"><header className="dispatch-section-head"><h3>Desks</h3><span>{open.length} open</span></header>{open.map(row)}{done.length ? <details className="radar-desks-done"><summary>✅ {done.length} done today</summary>{done.map(row)}<p>Hidden after 24 quiet hours</p></details> : null}</section>;
}
