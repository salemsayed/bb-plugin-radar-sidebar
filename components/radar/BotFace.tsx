import { useId, type ReactNode } from "react";
import { botStyle, type BotMascot, type BotState } from "./bots";

/**
 * The crew's characters (Salem, thr_2gjivwx8ea: "the bots characters need some love"). Each keeps the
 * silhouette it is known by, so the crew still reads by shape before colour, and now has volume (lit from
 * above, with a soft highlight), a thin edge in its own deep tone, a face with eyes, cheeks and a mouth, and one prop of its own: Personal's star antenna, Home's chimney, Bricks' hard hat, Work's
 * handle, ERBareeq's bolt and Lab's flask of liquid.
 */

interface Palette { base: string; light: string; line: string }
const PALETTE: Record<BotMascot, Palette> = {
  security: { base: "hsl(185 62% 36%)", light: "hsl(182 70% 57%)", line: "hsl(190 60% 19%)" },
  personal: { base: "hsl(214 72% 52%)", light: "hsl(211 88% 66%)", line: "hsl(220 55% 24%)" },
  home: { base: "hsl(152 58% 38%)", light: "hsl(148 60% 52%)", line: "hsl(158 55% 17%)" },
  bricks: { base: "hsl(14 70% 46%)", light: "hsl(18 82% 58%)", line: "hsl(10 60% 22%)" },
  work: { base: "hsl(266 46% 48%)", light: "hsl(264 62% 66%)", line: "hsl(268 45% 24%)" },
  erbareeq: { base: "hsl(34 90% 46%)", light: "hsl(44 96% 57%)", line: "hsl(28 70% 22%)" },
  lab: { base: "hsl(332 64% 46%)", light: "hsl(336 78% 60%)", line: "hsl(330 55% 22%)" },
};
const INK = "#1b1726";
const HAT = "hsl(46 96% 56%)";
const HAT_EDGE = "hsl(38 80% 38%)";
const CHEEK = "hsl(350 95% 72%)";

/** Each body's outline, and the box its light face fills (the shaded rim shows below and to the end). */
const BODY: Record<BotMascot, { d: string; box: [number, number, number, number]; face: [number, number] }> = {
  security: { d: "M22 5L37 11V23C37 31 30 37 22 40C14 37 7 31 7 23V11Z", box: [21, 22, 14, 15], face: [22, 23] },
  personal: { d: "M22 9a15 15 0 1 1 0 30a15 15 0 1 1 0-30Z", box: [20.6, 22.4, 14, 14], face: [22, 24.5] },
  home: { d: "M22 7.5L37 19.6V33.5a3.5 3.5 0 0 1-3.5 3.5h-23A3.5 3.5 0 0 1 7 33.5V19.6Z", box: [20.6, 21.5, 15.5, 15], face: [22, 27] },
  bricks: { d: "M9.5 15h25a4.5 4.5 0 0 1 4.5 4.5v10a4.5 4.5 0 0 1-4.5 4.5h-25A4.5 4.5 0 0 1 5 29.5v-10A4.5 4.5 0 0 1 9.5 15Z", box: [20.5, 23, 17.5, 9.4], face: [22, 25.4] },
  work: { d: "M12 15.5h20a6 6 0 0 1 6 6v9.5a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6v-9.5a6 6 0 0 1 6-6Z", box: [20.6, 24.6, 16.2, 10.5], face: [22, 27] },
  erbareeq: { d: "M22 5.5C29.5 14.5 35 22 35 29.5A13 13 0 1 1 9 29.5C9 22 14.5 14.5 22 5.5Z", box: [20.6, 26, 12.8, 15.5], face: [22, 29.5] },
  lab: { d: "M17 5.5h10a1.6 1.6 0 0 1 0 3.2h-.4v6.6l9.4 17A3.8 3.8 0 0 1 32.7 38h-21.4A3.8 3.8 0 0 1 8 32.3l9.4-17V8.7H17a1.6 1.6 0 0 1 0-3.2Z", box: [21, 31.6, 12.5, 7.6], face: [22, 30.5] },
};

/** What sits behind the body (drawn first) and on top of it (drawn last). */
function behind(mascot: BotMascot, palette: Palette): ReactNode {
  if (mascot === "home") return <rect x="27" y="9.5" width="4.6" height="8.5" rx="1" fill={palette.base} stroke={palette.line} strokeOpacity="0.4" strokeWidth="1.2" />;
  if (mascot === "work") return <path d="M17 15.5v-2.2a3.2 3.2 0 0 1 3.2-3.2h3.6a3.2 3.2 0 0 1 3.2 3.2v2.2" fill="none" stroke={palette.base} strokeWidth="2.6" strokeLinecap="round" />;
  if (mascot === "personal") return <path d="M22 9V5.4" stroke={palette.base} strokeWidth="1.6" strokeLinecap="round" />;
  return null;
}
function onTop(mascot: BotMascot, palette: Palette): ReactNode {
  switch (mascot) {
    case "personal":
      return <path d="M22 1.2l1.1 2.2 2.4.3-1.8 1.7.5 2.4L22 6.6l-2.2 1.2.5-2.4-1.8-1.7 2.4-.3Z" fill={HAT} stroke={HAT_EDGE} strokeWidth="0.8" strokeLinejoin="round" />;
    case "bricks":
      // A hard hat: the brick is a builder.
      return <g stroke={HAT_EDGE} strokeWidth="1" strokeLinejoin="round">
        <path d="M13.2 15.2a8.8 7 0 0 1 17.6 0Z" fill={HAT} />
        <rect x="10" y="14" width="24" height="3" rx="1.5" fill={HAT} />
        <path d="M22 8.6v4" fill="none" strokeLinecap="round" />
      </g>;
    case "work":
      return <rect x="19.4" y="14" width="5.2" height="3.4" rx="1.1" fill={palette.light} stroke={palette.line} strokeOpacity="0.45" strokeWidth="1" />;
    case "erbareeq":
      return <path d="M23.6 10.2 19.4 16.6h2.9l-.9 4.6 4.8-6.8h-2.9z" fill="#fff" opacity="0.95" />;
    case "lab":
      return <g fill="#fff" opacity="0.85"><circle cx="15" cy="34.4" r="1.4" /><circle cx="29.4" cy="35" r="1" /><circle cx="31" cy="32.2" r="0.7" /></g>;
    default:
      return null;
  }
}

/**
 * Each state has its own expression, so the face alone reads it: a calm smile when idle, eyes down and an
 * open smile while busy, raised brows and an "o" when it needs Salem, a worried frown when something failed,
 * asleep with a "z" when unreachable.
 */
function face(state: BotState | undefined, [fx, fy]: [number, number], palette: Palette): ReactNode {
  const stroke = { fill: "none", stroke: INK, strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const my = fy + 4.4;
  const eye = (x: number, y: number, rx = 2.3, ry = 2.9) => (
    <g key={x}><ellipse cx={x} cy={y} rx={rx} ry={ry} fill={INK} /><circle cx={x + 0.8} cy={y - 1.1} r={0.85} fill="#fff" /></g>
  );
  const cheeks = <g fill={CHEEK} opacity="0.38"><ellipse cx={fx - 8} cy={fy + 3} rx="2.1" ry="1.3" /><ellipse cx={fx + 8} cy={fy + 3} rx="2.1" ry="1.3" /></g>;
  if (state === "failed") {
    return <g>{eye(fx - 4.6, fy + 0.4, 2.1, 2.5)}{eye(fx + 4.6, fy + 0.4, 2.1, 2.5)}
      <path d={`M${fx - 7.4} ${fy - 3.4}l3.6-1.6M${fx + 7.4} ${fy - 3.4}l-3.6-1.6`} {...stroke} strokeWidth={1.5} />
      <path d={`M${fx - 2.6} ${my + 1.4}q2.6-2.4 5.2 0`} {...stroke} /></g>;
  }
  if (state === "working" || state === "rollover") {
    // Eyes down on the task and an open, eager mouth: busy and glad of it.
    return <g>{cheeks}{eye(fx - 4.6, fy + 0.8, 2.2, 2.5)}{eye(fx + 4.6, fy + 0.8, 2.2, 2.5)}
      <path d={`M${fx - 2.4} ${my - 0.2}h4.8a2.4 2.4 0 0 1-4.8 0Z`} fill={INK} /></g>;
  }
  if (state === "needs-you" || state === "decision") {
    return <g>{cheeks}{eye(fx - 4.6, fy, 2.5, 3.3)}{eye(fx + 4.6, fy, 2.5, 3.3)}
      <path d={`M${fx - 6.8} ${fy - 4.9}q2.2-1.7 4.4 0M${fx + 2.4} ${fy - 4.9}q2.2-1.7 4.4 0`} {...stroke} strokeWidth={1.4} />
      <ellipse cx={fx} cy={my + 0.9} rx="1.6" ry="1.9" fill={INK} /></g>;
  }
  if (state === "unavailable") {
    return <g>
      <path d={`M${fx - 6.8} ${fy}q2.2 1.9 4.4 0M${fx + 2.4} ${fy}q2.2 1.9 4.4 0`} {...stroke} />
      <path d={`M${fx - 1.2} ${my + 0.4}h2.4`} {...stroke} />
      <path d="M33 4.6h3.6l-3.6 3.8h3.6" fill="none" stroke={palette.base} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></g>;
  }
  return <g>{cheeks}{eye(fx - 4.6, fy)}{eye(fx + 4.6, fy)}<path d={`M${fx - 2.6} ${my}q2.6 2.5 5.2 0`} {...stroke} /></g>;
}

/** A bot's face: a character in its colours for the named crew, its letter otherwise. */
export function BotFace({ botKey, name, state, size = 24 }: { botKey: string; name: string; state?: BotState; size?: number | string }) {
  const { emoji, mascot } = botStyle(botKey, name);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!mascot) return <span className="bot-face-text">{emoji}</span>;
  const palette = PALETTE[mascot];
  const body = BODY[mascot];
  const [cx, cy, rx, ry] = body.box;
  const fill = `bot-fill-${id}`, clip = `bot-clip-${id}`;
  return (
    <svg className="bot-mascot" data-mascot={mascot} width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <defs>
        {/* Light from above: the body runs from its light tone at the top to its base at the bottom. */}
        <linearGradient id={fill} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={palette.light} />
          <stop offset="1" stopColor={palette.base} />
        </linearGradient>
        <clipPath id={clip}><path d={body.d} /></clipPath>
      </defs>
      {behind(mascot, palette)}
      <g clipPath={`url(#${clip})`}>
        {mascot === "lab" ? (
          // Glass above, the bot's liquid below: the face floats in it.
          <><path d={body.d} fill="hsl(330 45% 95%)" /><rect x="0" y="23" width="44" height="21" fill={`url(#${fill})`} /></>
        ) : <path d={body.d} fill={`url(#${fill})`} />}
        {/* A soft highlight on the upper start side gives the body its volume. */}
        <ellipse cx={cx - rx * 0.55} cy={cy - ry * 0.62} rx="2.8" ry="1.6" transform={`rotate(-32 ${cx - rx * 0.55} ${cy - ry * 0.62})`} fill="#fff" opacity="0.5" />
      </g>
      {/* A thin edge in the body's own deep tone holds the shape on light and dark sidebars without a cartoon outline. */}
      <path d={body.d} fill="none" stroke={palette.line} strokeOpacity="0.4" strokeWidth="1.2" strokeLinejoin="round" />
      {mascot === "lab" ? <path d="M10.8 23h22.4" stroke={palette.line} strokeWidth="1" strokeLinecap="round" opacity="0.35" /> : null}
      {face(state, body.face, palette)}
      {onTop(mascot, palette)}
    </svg>
  );
}
