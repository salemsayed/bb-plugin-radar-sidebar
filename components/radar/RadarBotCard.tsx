import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { STATE_LABELS, shortBotName, type BotState, type Pulse, type RosterBot } from "./bots";
import { BotAvatar } from "./BotAvatar";
import { botActivityText, type BotActivity } from "./botScope";
import type { GroupHeaderData } from "./RadarGroupHeader";

interface Props {
  thread: PluginSidebarThread;
  name: string;
  botKey: string;
  hue: number;
  state: BotState;
  activity?: BotActivity;
  rolloverBlocked?: boolean;
  pulse: Pulse | null;
  group: GroupHeaderData;
  isCollapsed: boolean;
  hasChildren: boolean;
  timeText: string;
  motion: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

/**
 * One coordinator as a card: a face in its colour, a ring that fills as its
 * context window does (rollover at 75%), the state, and the one line that
 * matters from its last reply. Workers fold underneath like any family.
 */
export function RadarBotCard({ thread, name, botKey, hue, state, activity, rolloverBlocked, pulse, group, isCollapsed, hasChildren, timeText, motion, onToggle, onNavigate }: Props) {
  const label = STATE_LABELS[state];
  const short = shortBotName(name);
  const line = pulse?.decision ? pulse.decision : pulse?.subject || "No reply yet";
  const kids = Math.max(0, group.total - 1);
  const context = pulse?.context ?? null;
  return (
    <div
      className={cn("radar-bot-card", `radar-bot-${state}`, thread.isUnread && "radar-bot-unread", motion && !rolloverBlocked && "radar-bot-motion")}
      style={{ "--bot-hue": hue } as React.CSSProperties}
      data-thread-id={thread.id}
    >
      <a className="radar-bot-main" href={thread.href} onClick={() => onNavigate()} aria-label={`${name}, ${label.text}${activity ? ` · ${botActivityText(activity)}` : ""}${rolloverBlocked ? " · Handover blocked" : ""}`} title={line}>
        <BotAvatar botKey={botKey} name={name} context={context} state={rolloverBlocked ? state : undefined} />
        <span className="radar-bot-body">
          <span className="radar-bot-head">
            <span className="radar-bot-name">{short}</span>
            {state === "idle" ? null : <span className={cn("radar-bot-chip", label.tone)}>{label.text}</span>}
            <span className="radar-bot-time">{timeText}</span>
          </span>
          {activity ? <span className="radar-bot-facts">{botActivityText(activity)}{rolloverBlocked ? " · Handover blocked" : ""}</span> : null}
          <span className={cn("radar-bot-line", pulse?.decision && "radar-bot-line-decision")}>
            {pulse?.decision ? <span className="radar-bot-line-prefix">Decision: </span> : null}
            {line}
          </span>
        </span>
      </a>
      {hasChildren ? (
        <button
          type="button"
          className="radar-bot-toggle"
          aria-expanded={!isCollapsed}
          aria-label={`${kids} thread${kids === 1 ? "" : "s"} under ${short}`}
          title={`${kids} thread${kids === 1 ? "" : "s"}`}
          onClick={onToggle}
        >
          {group.failed > 0 ? (
            <span className="radar-dot radar-dot-error" />
          ) : group.needsUser > 0 ? (
            <span className="radar-dot radar-dot-attention radar-dot-pulse" />
          ) : group.live > 0 ? (
            <span className="radar-spinner radar-tone-running"><Icon name="Loading" aria-hidden="true" /></span>
          ) : null}
          <span className="radar-bot-count">{kids}</span>
          <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** A cached blocked journal is still known when its coordinator row has not arrived. */
export function RadarMissingBotCard({ bot, activity, onNavigate }: {
  bot: RosterBot; activity: BotActivity; onNavigate: () => void;
}) {
  return <div className="radar-bot-card radar-bot-failed">
    <a className="radar-bot-main" href={`/projects/${bot.projectId}/threads/${bot.current}`} onClick={onNavigate}
      aria-label={`${bot.name}, Failed · ${botActivityText(activity)} · Handover blocked`}>
      <BotAvatar botKey={bot.key} name={bot.name} state="failed" />
      <span className="radar-bot-body">
        <span className="radar-bot-head"><span className="radar-bot-name">{shortBotName(bot.name)}</span><span className="radar-bot-chip radar-tone-error">Failed</span></span>
        <span className="radar-bot-facts">{botActivityText(activity)} · Handover blocked</span>
        <span className="radar-bot-line">Coordinator status unavailable</span>
      </span>
    </a>
  </div>;
}
