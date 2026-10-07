import { cn } from "@/lib/utils";

const RADIUS = 17;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Shared context gauge for the deck and compact rail. */
export function BotAvatar({ emoji, context }: { emoji: string; context: number | null }) {
  const fill = context === null ? 0 : Math.min(1, Math.max(0, context));
  const tone = context === null ? "radar-bot-ring-unknown" : fill >= 0.75 ? "radar-bot-ring-hot" : fill >= 0.6 ? "radar-bot-ring-warm" : "";
  return (
    <span className="radar-bot-avatar" aria-hidden="true">
      <svg className={cn("radar-bot-ring", tone)} viewBox="0 0 40 40">
        <circle className="radar-bot-ring-track" cx="20" cy="20" r={RADIUS} />
        <circle className="radar-bot-ring-fill" cx="20" cy="20" r={RADIUS}
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fill)} />
      </svg>
      <span className="radar-bot-face">{emoji}</span>
    </span>
  );
}
