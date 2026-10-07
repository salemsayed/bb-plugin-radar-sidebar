import { useLayoutEffect, useRef, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useModelDisplayName } from "./useThreadExecution";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./BotAvatar";
import { botStyle, needsYou, STATE_LABELS, type BotState, type Pulse, type RosterBot } from "./bots";
import { isRunningThread, timeAgo } from "./time";
import type { RailTip } from "./railTooltip";

function workerState(thread: PluginSidebarThread): BotState | "queued" {
  if (thread.status === "error" || thread.indicator === "unread-error" || thread.indicator === "queued-failed") return "failed";
  if (needsYou(thread)) return "needs-you";
  if (isRunningThread(thread)) return "working";
  if (thread.queuedWork !== "none") return "queued";
  return thread.isUnread ? "unread" : "idle";
}
const PRIORITY = { failed: 0, "needs-you": 1, working: 2, queued: 3, unread: 4, idle: 5, decision: 1, rollover: 2 };
function tokenCount(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Live facts from the roster and sidebar; hover never creates a coordinator turn. */
export function RadarBotHoverCard({ bot, coordinator, pulse, workers, state, tip, onKeepOpen, onLeave, onClose, onNavigate, onViewWorkers }: {
  bot: RosterBot;
  coordinator: PluginSidebarThread | undefined;
  pulse: Pulse | null;
  workers: readonly PluginSidebarThread[];
  state: BotState;
  tip: RailTip;
  onKeepOpen: () => void;
  onLeave: () => void;
  onClose: () => void;
  onNavigate: () => void;
  onViewWorkers: () => void;
}) {
  const sdk = useSdk();
  const modelName = useModelDisplayName(coordinator?.providerId ?? bot.providerId, pulse?.contextModel || bot.model, sdk);
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: tip.top, left: tip.left });
  useLayoutEffect(() => {
    const rect = card.current?.getBoundingClientRect();
    if (!rect) return;
    const top = Math.max(rect.height / 2 + 8, Math.min(tip.top, window.innerHeight - rect.height / 2 - 8));
    const left = Math.max(8, Math.min(tip.left, window.innerWidth - rect.width - 8));
    setPosition(previous => previous.top === top && previous.left === left ? previous : { top, left });
  }, [tip.top, tip.left, pulse, workers, state, modelName]);
  const style = botStyle(bot.key, bot.name);
  const label = STATE_LABELS[state];
  const context = pulse?.context ?? null;
  const reply = pulse?.preview ?? pulse?.subject;
  const ordered = workers.map(thread => ({ thread, state: workerState(thread) })).sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || b.thread.latestAttentionAt - a.thread.latestAttentionAt);
  const counts = (wanted: string) => ordered.filter(worker => worker.state === wanted).length;
  const activity = ([['working', 'working'], ['needs-you', 'waiting on you'], ['failed', 'failed'], ['queued', 'queued'], ['unread', 'new'], ['idle', 'idle']] as const)
    .filter(([key]) => counts(key) > 0).map(([key, word]) => `${counts(key)} ${word}`).join(" · ");
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onNavigate();
  };
  return (
    <div ref={card} role="dialog" id="radar-bot-hover-card" aria-label={`${bot.name} details`} data-radar-bot-hover
      className="radar-rail-tip radar-bot-hover" style={{ ...position, "--bot-hue": style.hue } as React.CSSProperties}
      onPointerEnter={onKeepOpen} onPointerLeave={onLeave} onFocus={onKeepOpen}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}
      onKeyDown={event => {
        if (event.key === "Escape" || (event.key === "Tab" && event.shiftKey && event.target === card.current?.querySelector("a"))) {
          event.preventDefault(); event.stopPropagation(); onClose();
        }
      }}>
      <div className="radar-bot-hover-head">
        <BotAvatar emoji={style.emoji} context={context} />
        <strong>{bot.name}</strong>
        <span className={cn("radar-bot-hover-state", label.tone)}>{label.text}</span>
      </div>
      <section className="radar-bot-hover-section" aria-label="Latest reply">
        <div className="radar-bot-hover-section-head"><span>Latest reply</span>
          {coordinator && pulse?.subject ? <span>{timeAgo(coordinator.latestAttentionAt, Date.now())}</span> : null}
        </div>
        {reply && !/^decision needed:/i.test(reply) ? <p className="radar-bot-hover-reply">{reply}</p> : !pulse?.decision ? <p className="radar-bot-hover-muted">No reply available yet.</p> : null}
        {pulse?.decision ? <div className="radar-bot-hover-decision"><strong>{coordinator?.isUnread ? "Needs your decision" : "Last decision request"}</strong><p>{pulse.decision}</p></div> : null}
        {coordinator?.hasPendingInteraction && !pulse?.decision ? <p className="radar-tone-warning">The coordinator is waiting for your input.</p> : null}
      </section>
      <section className="radar-bot-hover-section" aria-label="Workers">
        <div className="radar-bot-hover-section-head"><span>Workers</span><span>{workers.length}</span></div>
        {workers.length === 0 ? <p className="radar-bot-hover-muted">No active worker threads.</p> : <>
          <p className="radar-bot-hover-muted">{activity}</p>
          <div className="radar-bot-hover-workers">
            {ordered.slice(0, 3).map(({ thread, state: worker }) => {
              const status = worker === "queued" ? { text: "Queued", tone: "radar-tone-info" } : STATE_LABELS[worker];
              return <a key={thread.id} href={thread.href} onClick={navigate} className="radar-bot-hover-worker">
                <span>{thread.displayTitle || thread.title || "Untitled thread"}</span><span className={status.tone}>{status.text}</span>
              </a>;
            })}
          </div>
          {workers.length > 3 ? <span className="radar-bot-hover-muted">{workers.length - 3} more in the worker list</span> : null}
        </>}
      </section>
      <section className="radar-bot-hover-section" aria-label="Context usage">
        <div className="radar-bot-hover-section-head"><span>Context</span><span>{context === null ? "Unavailable" : `${Math.round(context * 100)}% used`}</span></div>
        {context === null ? <p className="radar-bot-hover-muted">No usage data available for this session.</p> : <>
          <div className={cn("radar-bot-hover-context", context >= 0.75 && "radar-bot-hover-context-hot", context >= 0.6 && context < 0.75 && "radar-bot-hover-context-warm")} role="meter" aria-label="Context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, Math.max(0, context)) * 100)}>
            <span style={{ width: `${Math.min(100, Math.max(0, context * 100))}%` }} />
          </div>
          {pulse?.contextUsedTokens != null && pulse.contextWindowTokens != null ? <p className="radar-bot-hover-muted">{tokenCount(pulse.contextUsedTokens)} / {tokenCount(pulse.contextWindowTokens)} tokens{pulse.contextEstimated ? " · estimated" : ""}</p> : null}
        </>}
        {bot.rollover ? <p className="radar-tone-info">Coordinator handover in progress.</p> : null}
      </section>
      <div className="radar-bot-hover-meta"><span>{modelName}</span>{coordinator?.host?.name ? <span>{coordinator.host.name}</span> : null}</div>
      <div className="radar-bot-hover-actions">
        <a href={coordinator?.href ?? `/projects/${bot.projectId}/threads/${bot.current}`} onClick={navigate}>Open coordinator</a>
        <button type="button" onClick={onViewWorkers}>View workers</button>
      </div>
    </div>
  );
}
