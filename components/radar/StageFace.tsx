import { useId, type ReactNode } from "react";
import { BODY, CHEEK, INK, PALETTE, behind, onTop, type Palette } from "./BotFace";
import { botStyle, shortBotName, type BotMascot } from "./bots";

export type StagePose = "idle" | "working" | "asking" | "unread" | "waiting" | "checking" | "blocked" | "offline" | "done";

const ARMS: Record<BotMascot, [number, number, number]> = {
  security: [8, 36, 24],
  personal: [7.4, 36.6, 27],
  home: [7.4, 36.6, 29],
  bricks: [5.4, 38.6, 27],
  work: [7, 37, 29],
  erbareeq: [9.6, 34.4, 30],
  lab: [10.5, 33.5, 31],
};

const GREY: Palette = { base: "hsl(260 6% 52%)", light: "hsl(260 8% 72%)", line: "hsl(260 10% 26%)" };
const LETTER_BODY = "M22 8a15 15 0 1 1 0 30a15 15 0 1 1 0-30Z";

const line = { fill: "none", stroke: INK, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function eye(x: number, y: number, rx = 2.3, ry = 2.9) {
  return <g key={`${x}-${y}`}><ellipse cx={x} cy={y} rx={rx} ry={ry} fill={INK} /><circle cx={x + 0.8} cy={y - 1.1} r={0.85} fill="#fff" /></g>;
}

function shut(x: number, y: number, up: boolean) {
  return <path key={`${x}-${y}`} d={`M${x - 2.3} ${y}q2.3 ${up ? -2.6 : 2.2} 4.6 0`} {...line} />;
}

function face(pose: StagePose, fy: number) {
  const o = (v: number) => v + fy - 27;
  const cheeks = <g fill={CHEEK} opacity="0.45"><ellipse cx="14" cy={o(30)} rx="2.1" ry="1.3" /><ellipse cx="30" cy={o(30)} rx="2.1" ry="1.3" /></g>;
  switch (pose) {
    case "idle":
      return <g>{cheeks}{shut(17.4, o(27.6), true)}{shut(26.6, o(27.6), true)}<path d={`M19.4 ${o(31)}q2.6 2.2 5.2 0`} {...line} /></g>;
    case "working":
      return <g>{cheeks}{eye(17.4, o(28.6), 2.1, 2.3)}{eye(26.6, o(28.6), 2.1, 2.3)}<path d={`M20.2 ${o(32.2)}h3.6a1.8 1.8 0 0 1-3.6 0Z`} fill={INK} /></g>;
    case "asking":
      return <g>{cheeks}{eye(17.4, o(27.2), 2.5, 3.3)}{eye(26.6, o(27.2), 2.5, 3.3)}
        <path d={`M14.6 ${o(22.4)}q2.2-1.7 4.4 0M25 ${o(22.4)}q2.2-1.7 4.4 0`} {...line} strokeWidth={1.4} />
        <ellipse cx="22" cy={o(32.4)} rx="1.6" ry="1.9" fill={INK} /></g>;
    case "unread":
      return <g>{cheeks}{eye(17.4, o(27.6))}{eye(26.6, o(27.6))}<path d={`M19.4 ${o(31)}q2.6 2.5 5.2 0`} {...line} /></g>;
    case "waiting":
      return <g>{cheeks}{eye(18.2, o(27.4), 2.1, 2.7)}{eye(27.4, o(27.4), 2.1, 2.7)}<path d={`M20.2 ${o(31.6)}h3.6`} {...line} /></g>;
    case "checking":
      return <g>{cheeks}{eye(17.4, o(27.6), 2.1, 2.7)}{eye(26.6, o(27.6), 2.1, 2.7)}
        <path d={`M14.8 ${o(23.2)}l4-.8`} {...line} strokeWidth={1.4} /><path d={`M20 ${o(31.6)}q2-1 4 0`} {...line} strokeWidth={1.5} /></g>;
    case "blocked": {
      const x = (cx: number, cy: number) => <path key={cx} d={`M${cx - 1.9} ${cy - 1.9}l3.8 3.8M${cx + 1.9} ${cy - 1.9}l-3.8 3.8`} {...line} />;
      return <g>{x(17.4, o(27.6))}{x(26.6, o(27.6))}<path d={`M19.4 ${o(32.6)}q2.6-2.4 5.2 0`} {...line} /></g>;
    }
    case "offline":
      return <g>{shut(17.4, o(27.2), false)}{shut(26.6, o(27.2), false)}<path d={`M20.8 ${o(32)}h2.4`} {...line} strokeWidth={1.5} /></g>;
    case "done":
      return <g>{cheeks}{shut(17.4, o(27.6), true)}{shut(26.6, o(27.6), true)}<path d={`M19.2 ${o(30.6)}h5.6a2.8 2.8 0 0 1-5.6 0Z`} fill={INK} /></g>;
  }
}

function arm(x1: number, y1: number, x2: number, y2: number, p: Palette, key: string) {
  const mx = (x1 + x2) / 2 + (x2 > x1 ? 2 : -2);
  return <g key={key} className="stage-arm">
    <path d={`M${x1} ${y1}Q${mx} ${(y1 + y2) / 2} ${x2} ${y2}`} fill="none" stroke={p.base} strokeWidth="3" strokeLinecap="round" />
    <circle cx={x2} cy={y2} r="2" fill={p.light} stroke={p.line} strokeOpacity=".4" strokeWidth=".8" />
  </g>;
}

function props(pose: StagePose, p: Palette, [ax1, ax2, ay]: [number, number, number]): { arms: ReactNode; before: ReactNode; after: ReactNode } {
  let left = arm(ax1, ay, ax1 - 3.5, ay + 5, p, "l");
  let right = arm(ax2, ay, ax2 + 3.5, ay + 5, p, "r");
  let before: ReactNode = null;
  let after: ReactNode = null;
  switch (pose) {
    case "working":
      left = arm(ax1, ay, 12, 40, p, "l");
      right = arm(ax2, ay, 32, 40, p, "r");
      after = <g className="stage-prop stage-keys">
        <rect x="11" y="39" width="22" height="4.5" rx="1.2" fill="#e9e6f2" stroke="#6e6880" strokeWidth=".8" />
        <path d="M14 41.2h6M22 41.2h3M27 41.2h3" stroke="#6e6880" strokeWidth=".9" strokeLinecap="round" />
        <path className="stage-busy-lines" d="M2 22l-2-1M2.5 18.5l-2-2.5M42 22l2-1M41.5 18.5l2-2.5" fill="none" stroke={p.light} strokeWidth="1.2" strokeLinecap="round" />
      </g>;
      break;
    case "asking":
      right = arm(ax2, ay - 2, 40, 15.5, p, "r");
      after = <g className="stage-prop stage-ask">
        <path d="M33.5 2.5h9a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-4.2l-2.8 2.6v-2.6h-2a3 3 0 0 1-3-3V5.5a3 3 0 0 1 3-3Z" fill="#ffc94d" stroke="#8a6200" strokeWidth=".8" />
        <path d="M36.2 6.6a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.9.7-.9 1.3v.4" fill="none" stroke="#1a1408" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="37.9" cy="12" r=".8" fill="#1a1408" />
      </g>;
      break;
    case "unread":
      left = arm(ax1, ay, 14, 37, p, "l");
      right = arm(ax2, ay, 30, 37, p, "r");
      after = <g className="stage-prop">
        <rect x="12.5" y="34" width="19" height="11" rx="1.6" fill="#fff" stroke="#3b46c4" strokeWidth="1" />
        <path d="M13 34.6l9 5.6 9-5.6" fill="none" stroke="#3b46c4" strokeWidth="1" strokeLinejoin="round" />
        <circle cx="31.5" cy="34" r="2.6" fill="#3b6cf0" stroke="#fff" strokeWidth="1" />
      </g>;
      break;
    case "waiting":
      right = arm(ax2, ay, 39.5, 23, p, "r");
      after = <g className="stage-prop">
        <circle cx="39.5" cy="17" r="5.6" fill="#fff" stroke="#57534e" strokeWidth="1.1" />
        <path d="M39.5 13.8V17l2.2 1.4" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      </g>;
      break;
    case "checking":
      right = arm(ax2, ay, 37.5, 22, p, "r");
      after = <g className="stage-prop">
        <circle cx="34" cy="17" r="5" fill="rgb(200 225 255 / .55)" stroke="#57534e" strokeWidth="1.4" />
        <path d="M37.4 20.8l2.6 3" stroke="#57534e" strokeWidth="2" strokeLinecap="round" />
      </g>;
      break;
    case "blocked":
      left = arm(ax1, ay, ax1 - 4, ay - 4, p, "l");
      right = arm(ax2, ay, ax2 + 4, ay - 4, p, "r");
      before = <g className="stage-prop stage-smoke" fill="#a8a29e" opacity=".75"><circle cx="33" cy="9" r="3.4" /><circle cx="37.5" cy="6.5" r="2.6" /><circle cx="40.6" cy="3.6" r="1.8" /></g>;
      break;
    case "offline":
      after = <g className="stage-prop" fill="none" stroke="#78716c" strokeLinecap="round" strokeLinejoin="round">
        <path d="M38 34q4 0 4 4v5" strokeWidth="1.2" />
        <path d="M39.6 43h4.8v-2.4h-4.8Z" fill="#78716c" />
        <path d="M34 5h4.2l-4.2 4.4h4.2" strokeWidth="1.3" />
      </g>;
      break;
    case "done":
      left = arm(ax1, ay - 2, 2.5, 17, p, "l");
      right = arm(ax2, ay - 2, 41.5, 17, p, "r");
      before = <g className="stage-prop stage-sparkle" fill="#ffc94d">
        <path d="M6 6l1 2.2 2.2 1-2.2 1L6 12.4l-1-2.2-2.2-1 2.2-1Z" />
        <path d="M38 4l.7 1.5 1.5.7-1.5.7L38 8.4l-.7-1.5-1.5-.7 1.5-.7Z" />
      </g>;
      break;
  }
  return { arms: <>{left}{right}</>, before, after };
}

const BARE_POSES: ReadonlySet<StagePose> = new Set(["asking", "unread"]);

export function StageFace({ botKey, name, pose, size = 88, bare = false }: { botKey: string; name: string; pose: StagePose; size?: number; bare?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { mascot, hue } = botStyle(botKey, name);
  const grey = pose === "offline";
  const palette = grey ? GREY : mascot ? PALETTE[mascot] : { base: `hsl(${hue} 50% 45%)`, light: `hsl(${hue} 65% 62%)`, line: `hsl(${hue} 50% 22%)` };
  const body = mascot ? BODY[mascot] : { d: LETTER_BODY, box: [20.6, 21, 14, 14] as [number, number, number, number], face: [22, 25] as [number, number] };
  const arms = mascot ? ARMS[mascot] : [7.4, 36.6, 26] as [number, number, number];
  const [cx, cy, rx, ry] = body.box;
  const fill = `stage-fill-${id}`, clip = `stage-clip-${id}`;
  const drawn = props(pose, palette, arms);
  const { arms: limbs, before } = drawn;
  const after = bare && BARE_POSES.has(pose) ? null : drawn.after;
  return (
    <svg className="stage-face" data-pose={pose} data-mascot={mascot ?? "letter"} width={size} height={size * 46 / 48} viewBox="-2 0 48 46" aria-hidden="true" focusable="false" opacity={grey ? 0.8 : undefined}>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={palette.light} />
          <stop offset="1" stopColor={palette.base} />
        </linearGradient>
        <clipPath id={clip}><path d={body.d} /></clipPath>
      </defs>
      {before}
      {mascot ? behind(mascot, palette) : null}
      <g className="stage-body">
        {limbs}
        <g clipPath={`url(#${clip})`}>
          {mascot === "lab"
            ? <><path d={body.d} fill="hsl(330 45% 95%)" /><rect x="0" y="23" width="44" height="21" fill={`url(#${fill})`} /></>
            : <path d={body.d} fill={`url(#${fill})`} />}
          <ellipse cx={cx - rx * 0.55} cy={cy - ry * 0.62} rx="2.8" ry="1.6" transform={`rotate(-32 ${cx - rx * 0.55} ${cy - ry * 0.62})`} fill="#fff" opacity="0.5" />
        </g>
        <path d={body.d} fill="none" stroke={palette.line} strokeOpacity="0.4" strokeWidth="1.2" strokeLinejoin="round" />
        {mascot === "lab" ? <path d="M10.8 23h22.4" stroke={palette.line} strokeWidth="1" strokeLinecap="round" opacity="0.35" /> : null}
        {mascot ? null : <text x="22" y="20" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff" opacity=".9">{shortBotName(name).slice(0, 1).toUpperCase()}</text>}
        {face(pose, body.face[1])}
        {mascot ? onTop(mascot, palette) : null}
      </g>
      {after}
    </svg>
  );
}
