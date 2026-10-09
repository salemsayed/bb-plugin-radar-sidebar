import { cn } from "@/lib/utils";
import type { BotState } from "./bots";
import { BotFace } from "./BotFace";

// The ring runs in the mascot art's margin, just outside the body, so it never cuts through the face.
const RADIUS = 18.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** State signals share one visual language in the rail, roster and details. */
export function BotAvatar({ botKey, name, context = null, state, unread = false, motion = true }: {
  botKey: string; name: string; context?: number | null; state?: BotState; unread?: boolean; motion?: boolean;
}) {
  const fill = context === null ? 0 : Math.min(1, Math.max(0, context));
  const tone = context === null ? "radar-bot-ring-unknown" : fill >= 0.75 ? "radar-bot-ring-hot" : fill >= 0.6 ? "radar-bot-ring-warm" : "";
  const badge = state === "failed" ? "!" : state === "needs-you" || state === "decision" ? "?" : null;
  const ring = state === "working" || state === "queued" || state === "rollover" || state === "unavailable";
  return <span className={cn("radar-bot-avatar", state && "radar-bot-avatar-state", state === "unavailable" && "radar-bot-avatar-unavailable")}
    data-bot-state={state} aria-hidden="true">
    {state === undefined ? <svg className={cn("radar-bot-ring", tone)} viewBox="0 0 40 40">
      <circle className="radar-bot-ring-track" cx="20" cy="20" r={RADIUS} />
      <circle className="radar-bot-ring-fill" cx="20" cy="20" r={RADIUS}
        strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fill)} />
    </svg> : ring ? (
      // Spin an HTML wrapper, not the SVG: transform animations on HTML run on the compositor,
      // so the ring keeps turning while BB's main thread is busy (an SVG animation froze with it).
      <span className={cn("radar-bot-state-spin", `radar-bot-state-spin-${state}`, motion && "radar-bot-state-motion")}>
        <svg className={cn("radar-bot-state-ring", `radar-bot-state-ring-${state}`)} viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={RADIUS} />
        </svg>
      </span>
    ) : null}
    <span className="radar-bot-face"><BotFace botKey={botKey} name={name} state={state} size="100%" /></span>
    {badge ? <span className={cn("radar-bot-attention-badge", state === "failed" ? "radar-bot-badge-error" : "radar-bot-badge-warning")}>{badge}</span> : null}
    {(unread || state === "unread") && !badge ? <span className="radar-bot-unread-dot" /> : null}
  </span>;
}
