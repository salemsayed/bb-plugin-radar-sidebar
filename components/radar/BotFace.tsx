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

/** A white mark on the body, a third identity cue behind shape and colour. */
const MARK: Record<BotMascot, ReactNode> = {
  personal: <path d="M22 4l2.5 4.6L29.5 11l-5 2.4L22 18l-2.5-4.6L14.5 11l5-2.4z" fill="#fff" />,
  home: <rect x="27.5" y="11" width="4.6" height="9" rx="1.2" fill="#fff" />,
  bricks: (
    <g fill="#fff" opacity="0.95">
      <rect x="12" y="20" width="20" height="2.6" rx="1.3" />
      <rect x="16" y="25.4" width="12" height="2.6" rx="1.3" />
    </g>
  ),
  work: null,
  erbareeq: <path d="M23.8 8.5L17 19h4.4l-1.2 7.5 7.6-11h-4.4z" fill="#fff" />,
};

const INK = "#12141a";

/** Eyes read the bot's state: calm, focused on a job, alert, or broken. */
function eyes(state: BotState | undefined): ReactNode {
  if (state === "failed") {
    return <g stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M14.5 20.5l4 4M18.5 20.5l-4 4" /><path d="M25.5 20.5l4 4M29.5 20.5l-4 4" /></g>;
  }
  if (state === "working" || state === "queued" || state === "rollover") {
    return <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round"><path d="M14 23q3-3.4 6 0" /><path d="M24 23q3-3.4 6 0" /></g>;
  }
  if (state === "needs-you" || state === "decision") {
    return <g><circle cx="17" cy="22" r="2.8" fill={INK} /><circle cx="27" cy="22" r="2.8" fill={INK} /><path d="M17 28.5q5 4 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" /></g>;
  }
  return <g><circle cx="17" cy="22" r="2.4" fill={INK} /><circle cx="27" cy="22" r="2.4" fill={INK} /><path d="M18 28.5q4 3 8 0" fill="none" stroke={INK} strokeWidth="1.9" strokeLinecap="round" /></g>;
}

/** A bot's face: a mascot in its colour for the named crew, its letter otherwise. */
export function BotFace({ botKey, name, state, size = 24 }: { botKey: string; name: string; state?: BotState; size?: number }) {
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
