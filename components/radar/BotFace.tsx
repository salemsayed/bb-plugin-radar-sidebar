import type { ReactNode } from "react";
import { botStyle, type BotMascot, type BotState } from "./bots";

/** The body shape each bot wears, so the crew reads by silhouette before colour. */
const BODY: Record<BotMascot, ReactNode> = {
  personal: <circle cx="22" cy="23" r="15.5" />,
  home: <path d="M22 7L37.5 19.2V33C37.5 35.2 35.7 37 33.5 37H10.5C8.3 37 6.5 35.2 6.5 33V19.2Z" />,
  bricks: <rect x="5" y="14" width="34" height="18" rx="4" />,
  work: (
    <g>
      <rect x="6.5" y="15.5" width="31" height="21.5" rx="6" />
      <path d="M18 15.5v-2.3a4 4 0 0 1 8 0v2.3" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  erbareeq: <path d="M22 6C29 15 34 22 34 29.5A12 12 0 1 1 10 29.5C10 22 15 15 22 6Z" />,
};

/** A white mark on the body, a third identity cue behind shape and colour. Kept clear of the face. */
const MARK: Record<BotMascot, ReactNode> = {
  personal: <path d="M22 4l2.5 4.6L29.5 11l-5 2.4L22 18l-2.5-4.6L14.5 11l5-2.4z" fill="#fff" />,
  home: <rect x="27.5" y="11" width="4.6" height="9" rx="1.2" fill="#fff" />,
  // Bricks reads by its brick shape; marks inside it read as teeth.
  bricks: null,
  work: null,
  erbareeq: <path d="M23.2 8.6L19.2 14.6h2.7l-.8 4.6 4.6-6.6h-2.7z" fill="#fff" />,
};

const INK = "#12141a";

/**
 * Each state has its own expression, so the face alone reads it: calm when
 * idle, glancing up while busy, wide-eyed and asking when it needs Salem,
 * crossed out when broken, asleep when unreachable.
 */
function eyes(state: BotState | undefined): ReactNode {
  const mouth = (d: string) => <path d={d} fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />;
  if (state === "failed") {
    return <g><g stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M14.5 19.5l4 4M18.5 19.5l-4 4" /><path d="M25.5 19.5l4 4M29.5 19.5l-4 4" /></g>{mouth("M18 29.5q4-2.6 8 0")}</g>;
  }
  if (state === "working" || state === "rollover") {
    return <g><circle cx="18" cy="21" r="2.3" fill={INK} /><circle cx="28" cy="21" r="2.3" fill={INK} />{mouth("M19 28.5h6")}</g>;
  }
  if (state === "needs-you" || state === "decision") {
    return <g><circle cx="17" cy="22" r="3.1" fill={INK} /><circle cx="27" cy="22" r="3.1" fill={INK} /><circle cx="17.9" cy="21.1" r="1" fill="#fff" /><circle cx="27.9" cy="21.1" r="1" fill="#fff" /><ellipse cx="22" cy="29.2" rx="2.1" ry="2.4" fill={INK} /></g>;
  }
  if (state === "unavailable") {
    return <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round"><path d="M14.5 22.5h5M24.5 22.5h5" />{mouth("M19.5 28.5h5")}</g>;
  }
  return <g><circle cx="17" cy="22" r="2.4" fill={INK} /><circle cx="27" cy="22" r="2.4" fill={INK} />{mouth("M18 28.5q4 3 8 0")}</g>;
}

/** A bot's face: a mascot in its colour for the named crew, its letter otherwise. */
export function BotFace({ botKey, name, state, size = 24 }: { botKey: string; name: string; state?: BotState; size?: number | string }) {
  const { emoji, hue, mascot } = botStyle(botKey, name);
  if (!mascot) return <span className="bot-face-text">{emoji}</span>;
  return (
    <svg className="bot-mascot" data-mascot={mascot} width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <g fill={`hsl(${hue} 70% 50%)`}>{BODY[mascot]}</g>
      {eyes(state)}
      {MARK[mascot]}
    </svg>
  );
}
