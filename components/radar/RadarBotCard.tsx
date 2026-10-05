import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { STATE_LABELS, shortBotName, type BotState, type Pulse } from "./bots";
import type { GroupHeaderData } from "./RadarGroupHeader";

interface Props {
  thread: PluginSidebarThread;
  name: string;
  emoji: string;
  hue: number;
  state: BotState;
  pulse: Pulse | null;
  group: GroupHeaderData;
  isCollapsed: boolean;
  hasChildren: boolean;
  timeText: string;
  motion: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

/**
 * One coordinator as a card: a face in its colour, a ring that fills as its
 * context window does (rollover at 75%), the state, and the one line that
 * matters from its last reply. Workers fold underneath like any family.
 */
export function RadarBotCard({ thread, name, emoji, hue, state, pulse, group, isCollapsed, hasChildren, timeText, motion, onToggle, onNavigate }: Props) {
  const label = STATE_LABELS[state];
  const short = shortBotName(name);
  const line = pulse?.decision ? pulse.decision : pulse?.subject || "No reply yet";
  const kids = Math.max(0, group.total - 1);
  const context = pulse?.context ?? null;
  const fill = context === null ? 0 : Math.min(1, Math.max(0, context));
  const ringTone = context === null ? "" : fill >= 0.75 ? "radar-bot-ring-hot" : fill >= 0.6 ? "radar-bot-ring-warm" : "";
  return (
    <div
      className={cn("radar-bot-card", `radar-bot-${state}`, thread.isUnread && "radar-bot-unread", motion && "radar-bot-motion")}
      style={{ "--bot-hue": hue } as React.CSSProperties}
      data-thread-id={thread.id}
    >
      <a className="radar-bot-main" href={thread.href} onClick={() => onNavigate()} aria-label={`${name}, ${label.text}`} title={line}>
        <span className="radar-bot-avatar" aria-hidden="true">
          <svg className={cn("radar-bot-ring", ringTone)} viewBox="0 0 40 40">
            <circle className="radar-bot-ring-track" cx="20" cy="20" r={RING_R} />
            <circle
              className="radar-bot-ring-fill"
              cx="20"
              cy="20"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - fill)}
            />
          </svg>
          <span className="radar-bot-face">{emoji}</span>
        </span>
        <span className="radar-bot-body">
          <span className="radar-bot-head">
            <span className="radar-bot-name">{short}</span>
            {state === "idle" ? null : <span className={cn("radar-bot-chip", label.tone)}>{label.text}</span>}
            <span className="radar-bot-time">{timeText}</span>
          </span>
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
