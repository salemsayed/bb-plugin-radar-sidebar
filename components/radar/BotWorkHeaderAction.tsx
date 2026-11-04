import { useMemo, useRef, useState } from "react";
import { useBbNavigate, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { isClosed, type BotTasksData } from "@/lib/botTasks";
import { useBotTasks } from "./useBotTasks";
import { useDispatchWorkers } from "./useDispatchWorkers";
import { BotWorkPanel } from "./DispatchBoard";
import { shortBotName } from "./bots";

export function BotWorkHeaderAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { data } = useBotTasks(true);
  const bot = data?.bots.find(b => b.coordinatorThreadId === threadId);
  if (!data || !bot) return null;
  return <WorkButton key={bot.key} data={data} botKey={bot.key} threadId={threadId} compact={isCompactViewport} />;
}

function WorkButton({ data, botKey, threadId, compact }: { data: BotTasksData; botKey: string; threadId: string; compact: boolean }) {
  const one = useMemo(() => ({ ...data, bots: data.bots.filter(b => b.key === botKey) }), [data, botKey]);
  const snapshot = useDispatchWorkers(one);
  const navigate = useBbNavigate();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const bot = one.bots[0];
  if (!bot) return null;
  const open_ = bot.tasks.filter(t => !isClosed(t.displayState)).length + bot.unlinked.length;
  const helpers = snapshot.byBot[bot.key]?.length ?? 0;
  const asks = bot.tasks.filter(t => t.displayState === "needs").length;
  const parts = [helpers ? `${helpers} ${helpers === 1 ? "helper" : "helpers"}` : "", open_ ? `${open_} ${open_ === 1 ? "task" : "tasks"}` : ""].filter(Boolean);
  const text = parts.join(" · ") || "No work";
  const close = () => { setOpen(false); setTimeout(() => button.current?.focus(), 0); };
  return <>
    <button ref={button} type="button" className="stage-work-pill" data-busy={helpers > 0 || undefined} data-asks={asks > 0 || undefined}
      aria-haspopup="dialog" aria-expanded={open} aria-label={`${shortBotName(bot.name)}'s work: ${text}`} onClick={() => setOpen(true)}>
      <span className="stage-work-dots" aria-hidden="true">{Array.from({ length: Math.min(helpers, 4) }, (_, i) => <i key={i} />)}</span>
      {compact ? (helpers || open_ || "") : text}
    </button>
    {open ? <BotWorkPanel bot={bot} snapshot={snapshot} activeThreadId={threadId} isCompactViewport={compact} now={Date.now()}
      onNavigate={id => { setOpen(false); navigate.toThread(id); }} onClose={close} /> : null}
  </>;
}
