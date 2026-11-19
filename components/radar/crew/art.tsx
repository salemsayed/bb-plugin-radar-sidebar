import type { ReactNode } from "react";

export type CrewShape = "personal" | "home" | "bricks" | "work" | "erbareeq" | "store" | "lab" | "security" | "chief" | "redflag" | "generic";
export type CrewLook = "idle" | "working" | "asking" | "waiting" | "checking" | "stuck" | "done" | "asleep";
export type CrewTab = "question" | "clock" | "lens" | "alert" | "letter" | "sleep" | "confetti";
export type CrewHands = "raised" | "cheer";
export type CrewDetail = "glyph" | "face" | "figure";
export interface CrewPaper { paper: string; shade: string; tint: string }

const HUE: Record<Exclude<CrewShape, "generic">, number> = {
  personal: 212, home: 146, bricks: 24, work: 268, erbareeq: 44, store: 95, lab: 335, security: 185, chief: 300, redflag: 354,
};
const TAKEN_HUES = Object.values(HUE);
const HUE_CLEARANCE = 20;

const PAPER: Record<Exclude<CrewShape, "generic">, CrewPaper> = {
  personal: { paper: "hsl(214 84% 57%)", shade: "hsl(221 68% 38%)", tint: "hsl(208 96% 78%)" },
  home: { paper: "hsl(150 56% 41%)", shade: "hsl(157 62% 25%)", tint: "hsl(142 56% 68%)" },
  bricks: { paper: "hsl(14 78% 53%)", shade: "hsl(9 70% 34%)", tint: "hsl(22 96% 74%)" },
  work: { paper: "hsl(264 58% 58%)", shade: "hsl(267 50% 38%)", tint: "hsl(260 86% 80%)" },
  erbareeq: { paper: "hsl(40 96% 51%)", shade: "hsl(29 88% 36%)", tint: "hsl(49 100% 76%)" },
  store: { paper: "hsl(92 54% 43%)", shade: "hsl(100 58% 26%)", tint: "hsl(82 68% 68%)" },
  lab: { paper: "hsl(334 76% 56%)", shade: "hsl(331 66% 36%)", tint: "hsl(340 96% 84%)" },
  security: { paper: "hsl(186 66% 39%)", shade: "hsl(191 70% 24%)", tint: "hsl(180 62% 66%)" },
  chief: { paper: "hsl(298 44% 50%)", shade: "hsl(296 50% 31%)", tint: "hsl(300 66% 78%)" },
  redflag: { paper: "hsl(354 76% 53%)", shade: "hsl(353 70% 34%)", tint: "hsl(2 96% 80%)" },
};
const ASLEEP: CrewPaper = { paper: "hsl(258 8% 60%)", shade: "hsl(258 10% 40%)", tint: "hsl(258 12% 78%)" };

const INK = "#1f1b2d";
const WHITE = "#fffdf7";
const SUN = "#ffc42e";
const SUN_SHADE = "#bf7f00";
const SLATE = "#6b6478";
const RED = "#e5484d";
const RED_SHADE = "#9c2a2f";
const BLUE = "#3d6ff2";
const BLUE_SHADE = "#2847a8";
const MINT = "#35c486";
const ROSE = "#ff6b9a";
const GLASS = "#cfe4ff";
const HAZE = "#8e889a";
const SLATE_SHADE = "#3f3a4a";

export const CREW_BOX = { width: 48, height: 46 };

function isDrawn(key: string): key is Exclude<CrewShape, "generic"> {
  return Object.hasOwn(PAPER, key);
}

export function crewShape(key: string): CrewShape {
  return isDrawn(key) ? key : "generic";
}

function hueGap(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

export function crewHue(key: string): number {
  if (isDrawn(key)) return HUE[key];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  let hue = Math.abs(hash) % 360;
  for (let step = 0; step < 12 && TAKEN_HUES.some(taken => hueGap(taken, hue) < HUE_CLEARANCE); step += 1) hue = (hue + 29) % 360;
  return hue;
}

export function crewPaper(key: string, asleep = false): CrewPaper {
  if (asleep) return ASLEEP;
  if (isDrawn(key)) return PAPER[key];
  const hue = crewHue(key);
  return { paper: `hsl(${hue} 54% 50%)`, shade: `hsl(${hue} 52% 31%)`, tint: `hsl(${hue} 72% 77%)` };
}

function star(cx: number, cy: number, outer: number, inner: number): string {
  const points = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 ? inner : outer;
    const angle = (index * 36 - 90) * Math.PI / 180;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

interface Shape {
  d: string;
  face: [number, number];
  crop: [number, number, number];
  back?: (paper: CrewPaper) => ReactNode;
  fill?: (paper: CrewPaper) => ReactNode;
  front?: (paper: CrewPaper, detail: CrewDetail) => ReactNode;
}

const LAB_LIQUID = "M14.8 26h18.4L38.4 35a4.2 4.2 0 0 1-3.7 6.3H13.3A4.2 4.2 0 0 1 9.6 35Z";

const SHAPES: Record<CrewShape, Shape> = {
  personal: {
    d: "M24 13a14.2 14.2 0 1 1 0 28.4a14.2 14.2 0 1 1 0-28.4Z",
    face: [24, 27.4],
    crop: [3.4, 1.4, 41.6],
    back: paper => <path d="M24 13.5V8" stroke={paper.shade} strokeWidth="2" strokeLinecap="round" />,
    front: () => <path d={star(24, 6.2, 4.7, 2.1)} fill={SUN} stroke={SUN} strokeWidth="0.8" strokeLinejoin="round" />,
  },
  home: {
    d: "M24 9.5 40 22.5V37.6a3.4 3.4 0 0 1-3.4 3.4H11.4A3.4 3.4 0 0 1 8 37.6V22.5Z",
    face: [24, 29.8],
    crop: [6.2, 7.6, 36.4],
    back: paper => <rect x="30.6" y="10.4" width="5.2" height="10" rx="1.1" fill={paper.shade} />,
  },
  bricks: {
    d: "M11 20.5h26a4.5 4.5 0 0 1 4.5 4.5v11a4.5 4.5 0 0 1-4.5 4.5H11A4.5 4.5 0 0 1 6.5 36V25A4.5 4.5 0 0 1 11 20.5Z",
    face: [24, 31],
    crop: [5.4, 7.4, 37.6],
    front: (_, detail) => <>
      <path d="M14.4 19.6a9.6 8.8 0 0 1 19.2 0Z" fill={SUN} />
      {detail === "glyph" ? null : <path d="M24 11.4v4.4" stroke={SUN_SHADE} strokeWidth="1.5" strokeLinecap="round" />}
      <rect x="10.8" y="18" width="26.4" height="3.6" rx="1.8" fill={SUN} stroke={SUN_SHADE} strokeWidth="0.7" />
    </>,
  },
  work: {
    d: "M13 18.5h22a6 6 0 0 1 6 6V35a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6V24.5a6 6 0 0 1 6-6Z",
    face: [24, 30.6],
    crop: [5.8, 8.2, 36.8],
    back: paper => <path d="M18.4 18.5v-3.2a3.6 3.6 0 0 1 3.6-3.6h4a3.6 3.6 0 0 1 3.6 3.6v3.2" fill="none" stroke={paper.shade} strokeWidth="3" strokeLinecap="round" />,
    front: paper => <rect x="21.2" y="16.8" width="5.6" height="4.2" rx="1.3" fill={paper.tint} />,
  },
  erbareeq: {
    d: "M24 6C31 15 37 22.5 37 29a13 13 0 1 1-26 0C11 22.5 17 15 24 6Z",
    face: [24, 31],
    crop: [4.6, 5, 39],
    front: () => <path d="M25.4 11.6 21.4 17.6h2.8l-.9 4.4 4.6-6.5h-2.8z" fill={WHITE} />,
  },
  store: {
    d: "M14 18h20a2.3 2.3 0 0 1 2.3 2l2.2 17.2a3.4 3.4 0 0 1-3.4 3.8H12.9a3.4 3.4 0 0 1-3.4-3.8L11.7 20A2.3 2.3 0 0 1 14 18Z",
    face: [24, 31.6],
    crop: [6.6, 7.6, 35.6],
    back: paper => <path d="M18.5 19v-4.6a5.5 5.5 0 0 1 11 0V19" fill="none" stroke={paper.shade} strokeWidth="2.8" strokeLinecap="round" />,
    front: paper => <g fill={paper.shade}><circle cx="18.5" cy="21.6" r="1.25" /><circle cx="29.5" cy="21.6" r="1.25" /></g>,
  },
  lab: {
    d: "M19.5 6.5h9a1.7 1.7 0 0 1 0 3.4h-.4v7.2L38.4 35a4.2 4.2 0 0 1-3.7 6.3H13.3A4.2 4.2 0 0 1 9.6 35L19.9 17.1V9.9h-.4a1.7 1.7 0 0 1 0-3.4Z",
    face: [24, 32.6],
    crop: [5.4, 5.4, 37.8],
    fill: paper => <>
      <path d={SHAPES.lab.d} fill={paper.tint} stroke={paper.tint} strokeWidth="1.4" strokeLinejoin="round" />
      <path d={LAB_LIQUID} fill={paper.paper} stroke={paper.paper} strokeWidth="1.4" strokeLinejoin="round" />
    </>,
    front: (paper, detail) => <g fill={paper.paper}><circle cx="22.8" cy="21.6" r="1.5" />{detail === "glyph" ? null : <><circle cx="25.8" cy="17.4" r="1.05" /><circle cx="23.4" cy="13.4" r="0.8" /></>}</g>,
  },
  security: {
    d: "M24 6.5 39 12.2V24.5c0 8.4-6.6 14.4-15 17.5C15.6 38.9 9 32.9 9 24.5V12.2Z",
    face: [24, 24.4],
    crop: [5.6, 5.4, 37.8],
    front: paper => <path d={star(24, 13.4, 3, 1.35)} fill={paper.tint} />,
  },
  chief: {
    d: "M14 12.5h20a4.5 4.5 0 0 1 4.5 4.5v20.5A4.5 4.5 0 0 1 34 42H14a4.5 4.5 0 0 1-4.5-4.5V17a4.5 4.5 0 0 1 4.5-4.5Z",
    face: [24, 28.6],
    crop: [6.4, 7.4, 36.2],
    front: paper => <>
      <rect x="18.1" y="9.4" width="13" height="7.6" rx="2.4" fill={paper.shade} />
      <rect x="17.5" y="8.6" width="13" height="7.6" rx="2.4" fill={paper.tint} />
      <circle cx="24" cy="11.6" r="1.3" fill={paper.shade} />
    </>,
  },
  redflag: {
    d: "M12.5 11.5H41l-5.2 12L41 35.5H12.5Z",
    face: [23.6, 22.6],
    crop: [5.4, 5.2, 39.8],
    back: paper => <path d="M10.8 9.5v34" stroke={paper.shade} strokeWidth="2.8" strokeLinecap="round" />,
    front: () => <circle cx="10.8" cy="7.8" r="2.3" fill={SUN} />,
  },
  generic: {
    d: "M24 12.5c9.4 0 15 5.4 15 14v4c0 7.4-6 11-15 11S9 37.9 9 30.5v-4c0-8.6 5.6-14 15-14Z",
    face: [24, 28.4],
    crop: [4.8, 3.2, 39.6],
    back: paper => <path d="M24 12.5V8" stroke={paper.shade} strokeWidth="2" strokeLinecap="round" />,
    front: paper => <circle cx="24" cy="6.4" r="2.5" fill={paper.tint} />,
  },
};

const EYE_GAP = 5.2;
const GAZE: Partial<Record<CrewLook, { x: number; y: number; r: number }>> = {
  idle: { x: 0, y: 0.5, r: 2.05 },
  working: { x: 0, y: 1.5, r: 2.05 },
  asking: { x: 0, y: -0.5, r: 2.35 },
  waiting: { x: 1.3, y: -1.2, r: 2.05 },
  checking: { x: 1.4, y: 0.3, r: 2.05 },
};

const line = { fill: "none", stroke: INK, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const lash = { fill: "none", stroke: WHITE, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function crewHasPupils(look: CrewLook): boolean {
  return look in GAZE;
}

export function crewPupils(shape: CrewShape, look: CrewLook, detail: CrewDetail): ReactNode {
  const gaze = GAZE[look];
  if (!gaze) return null;
  const [ax, ay] = SHAPES[shape].face;
  const radius = detail === "glyph" ? gaze.r + 0.25 : gaze.r;
  return <g fill={INK}>
    <circle cx={ax - EYE_GAP + gaze.x} cy={ay + gaze.y} r={radius} />
    <circle cx={ax + EYE_GAP + gaze.x} cy={ay + gaze.y} r={radius} />
  </g>;
}

function whites(ax: number, ay: number, rx: number, ry: number): ReactNode {
  return <g fill={WHITE}><ellipse cx={ax - EYE_GAP} cy={ay} rx={rx} ry={ry} /><ellipse cx={ax + EYE_GAP} cy={ay} rx={rx} ry={ry} /></g>;
}

function expression(shape: CrewShape, look: CrewLook, detail: CrewDetail, paper: CrewPaper, atLaptop: boolean): ReactNode {
  const [ax, ay] = SHAPES[shape].face;
  const glyph = detail === "glyph";
  const left = ax - EYE_GAP, right = ax + EYE_GAP;
  const cheeks = detail === "figure" ? <g fill={paper.tint}><circle cx={ax - 10} cy={ay + 4.6} r="1.7" /><circle cx={ax + 10} cy={ay + 4.6} r="1.7" /></g> : null;
  const mouth = (d: string, props: object = line) => glyph ? null : <path d={d} {...props} />;
  switch (look) {
    case "idle":
      return <>{whites(ax, ay, glyph ? 3.9 : 3.5, glyph ? 4.3 : 4)}{mouth(`M${ax - 2.6} ${ay + 6.2}q2.6 2.3 5.2 0`)}</>;
    case "working":
      return <>{cheeks}{whites(ax, ay + 0.6, glyph ? 3.9 : 3.5, glyph ? 3.9 : 3.5)}
        {glyph ? null : <path d={`M${ax - 9.4} ${ay - 3.6}h18.8v2.5h-18.8Z`} fill={paper.paper} />}
        {atLaptop ? laptop(ax, ay, paper) : mouth(`M${ax - 1.7} ${ay + 6.6}q1.7 1.5 3.4 0`)}</>;
    case "asking":
      return <>{cheeks}{whites(ax, ay, glyph ? 4.1 : 3.9, glyph ? 4.6 : 4.6)}
        {glyph ? null : <path d={`M${left - 2.5} ${ay - 6.4}q2.5-1.5 5 0M${right - 2.5} ${ay - 6.4}q2.5-1.5 5 0`} {...line} strokeWidth={1.4} />}
        {glyph ? null : <ellipse cx={ax} cy={ay + 7.2} rx="1.5" ry="1.8" fill={INK} />}</>;
    case "waiting":
      return <>{whites(ax, ay, glyph ? 3.9 : 3.5, glyph ? 4.3 : 4)}{mouth(`M${ax - 1.8} ${ay + 6.8}h3.6`)}</>;
    case "checking":
      return <>{whites(ax, ay, glyph ? 3.9 : 3.5, glyph ? 4.3 : 4)}
        {glyph ? null : <path d={`M${left - 2.6} ${ay - 5.6}h5M${right - 2.4} ${ay - 6.6}l5-1.2`} {...line} strokeWidth={1.4} />}
        {mouth(`M${ax - 1.8} ${ay + 7.1}l3.6-.8`)}</>;
    case "stuck": {
      const cross = (x: number) => `M${x - 2.3} ${ay - 2.3}l4.6 4.6M${x + 2.3} ${ay - 2.3}l-4.6 4.6`;
      return <><path d={`${cross(left)}${cross(right)}`} {...lash} strokeWidth={glyph ? 2.4 : 2} />
        {mouth(`M${ax - 3.2} ${ay + 7.2}l1.6-1.4 1.6 1.4 1.6-1.4 1.6 1.4`, { ...line, strokeWidth: 1.4 })}</>;
    }
    case "done":
      return <>{cheeks}<path d={`M${left - 3} ${ay + 1.2}q3-4.4 6 0M${right - 3} ${ay + 1.2}q3-4.4 6 0`} {...lash} strokeWidth={glyph ? 2.4 : 2} />
        {glyph ? null : <path d={`M${ax - 2.8} ${ay + 5}h5.6a2.8 2.8 0 0 1-5.6 0Z`} fill={INK} />}</>;
    case "asleep":
      return <><path d={`M${left - 2.8} ${ay}q2.8 2.4 5.6 0M${right - 2.8} ${ay}q2.8 2.4 5.6 0`} {...line} strokeWidth={glyph ? 2 : 1.6} />{mouth(`M${ax - 1.2} ${ay + 6.4}h2.4`)}</>;
  }
}

function laptop(ax: number, ay: number, paper: CrewPaper): ReactNode {
  const top = ay + 5.4;
  return <>
    <rect x={ax - 10.3} y={top + 0.9} width="22" height="8.4" rx="1.9" fill={SLATE_SHADE} />
    <rect x={ax - 11} y={top} width="22" height="8.4" rx="1.9" fill={SLATE} />
    <circle cx={ax} cy={top + 4.2} r="1.5" fill={paper.tint} />
    {hand(ax - 9.4, top + 0.3, paper, 2.2)}
    {hand(ax + 9.4, top + 0.3, paper, 2.2)}
  </>;
}

export function crewBody(shape: CrewShape, look: CrewLook, detail: CrewDetail, paper: CrewPaper, extras: { laptop?: boolean; tab?: CrewTab } = {}): ReactNode {
  const spec = SHAPES[shape];
  return <>
    {spec.back?.(paper)}
    {detail === "glyph" ? null : <path d={spec.d} transform="translate(1.1 1.5)" fill={paper.shade} stroke={paper.shade} strokeWidth="1.4" strokeLinejoin="round" />}
    {spec.fill ? spec.fill(paper) : <path d={spec.d} fill={paper.paper} stroke={paper.paper} strokeWidth="1.4" strokeLinejoin="round" />}
    {spec.front?.(paper, detail)}
    {expression(shape, look, detail, paper, !!extras.laptop)}
    {extras.tab ? crewTab(extras.tab) : null}
  </>;
}

export function crewCrop(shape: CrewShape): string {
  const [x, y, size] = SHAPES[shape].crop;
  return `${x} ${y} ${size} ${size}`;
}

function hand(x: number, y: number, paper: CrewPaper, radius = 2.6): ReactNode {
  return <g key={`${x}-${y}`}><circle cx={x + 0.6} cy={y + 0.8} r={radius} fill={paper.shade} /><circle cx={x} cy={y} r={radius} fill={paper.tint} /></g>;
}

const REACH = 19.4;
const HAND_MIN_X = 4.4;
const HAND_MAX_X = CREW_BOX.width - 4.4;

function shoulder(shape: CrewShape, side: -1 | 1): [number, number] {
  const [ax, ay] = SHAPES[shape].face;
  return [ax + side * 9, ay + 6];
}

function arm(shape: CrewShape, side: -1 | 1, lift: number, paper: CrewPaper): ReactNode {
  const [ax, ay] = SHAPES[shape].face;
  const [sx, sy] = shoulder(shape, side);
  const hx = Math.min(HAND_MAX_X, Math.max(HAND_MIN_X, ax + side * REACH));
  const hy = ay - lift;
  return <g key={side}>
    <path d={`M${sx} ${sy}L${hx} ${hy}`} stroke={paper.paper} strokeWidth="3.2" strokeLinecap="round" />
    {hand(hx, hy, paper)}
  </g>;
}

export function crewHands(shape: CrewShape, hands: CrewHands, paper: CrewPaper): ReactNode {
  if (hands === "raised") return arm(shape, 1, 6.5, paper);
  return <>{arm(shape, -1, 9, paper)}{arm(shape, 1, 9, paper)}</>;
}

export function crewShoulder(shape: CrewShape): string {
  const [x, y] = shoulder(shape, 1);
  return `${(x / CREW_BOX.width * 100).toFixed(1)}% ${(y / CREW_BOX.height * 100).toFixed(1)}%`;
}

function crewTab(tab: CrewTab): ReactNode {
  switch (tab) {
    case "question": {
      const bubble = "M35.2 1.8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-3.6l-2.9 2.7v-2.7h-1.5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z";
      return <>
        <path d={bubble} transform="translate(0.7 0.9)" fill={SUN_SHADE} />
        <path d={bubble} fill={SUN} />
        <path d="M37.3 5.9a1.95 1.95 0 1 1 2.8 1.75c-.6.3-.9.7-.9 1.3" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="39.2" cy="10.7" r="0.85" fill={INK} />
      </>;
    }
    case "clock":
      return <>
        <circle cx="41.1" cy="9.2" r="5.6" fill={SLATE} />
        <circle cx="40.4" cy="8.3" r="5.6" fill={WHITE} stroke={SLATE} strokeWidth="1.1" />
        <path d="M40.4 5.1v3.2l2.2 1.5" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </>;
    case "lens":
      return <>
        <path d="M42 12l3.2 3.6" stroke={SLATE} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="38.6" cy="8.2" r="4.8" fill={GLASS} stroke={SLATE} strokeWidth="1.9" />
      </>;
    case "alert": {
      const sign = "M40.4 2.4l5.8 10.2H34.6Z";
      return <>
        <path d={sign} transform="translate(0.7 0.9)" fill={RED_SHADE} stroke={RED_SHADE} strokeWidth="2" strokeLinejoin="round" />
        <path d={sign} fill={RED} stroke={RED} strokeWidth="2" strokeLinejoin="round" />
        <path d="M40.4 6v3.2" stroke={WHITE} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="40.4" cy="11.3" r="0.85" fill={WHITE} />
      </>;
    }
    case "letter":
      return <>
        <rect x="33.4" y="4" width="12.6" height="9.2" rx="1.6" fill={BLUE_SHADE} />
        <rect x="32.8" y="3.2" width="12.6" height="9.2" rx="1.6" fill={WHITE} stroke={BLUE} strokeWidth="1" />
        <path d="M33.6 4.2l5.5 4.2 5.5-4.2" fill="none" stroke={BLUE} strokeWidth="1.1" strokeLinejoin="round" />
        <circle cx="45.2" cy="3.4" r="2.2" fill={BLUE} />
      </>;
    case "sleep":
      return <g fill="none" stroke={HAZE} strokeLinecap="round" strokeLinejoin="round">
        <path d="M35.6 3.4h4.8l-4.8 5.6h4.8" strokeWidth="1.6" />
        <path d="M42.6 9.6h3l-3 3.6h3" strokeWidth="1.3" />
      </g>;
    case "confetti":
      return <>
        <rect x="4.2" y="4.4" width="3.4" height="3.4" rx="0.7" transform="rotate(22 5.9 6.1)" fill={SUN} />
        <rect x="9.4" y="10.6" width="4.2" height="1.7" rx="0.85" transform="rotate(-32 11.5 11.4)" fill={MINT} />
        <circle cx="42.8" cy="5.4" r="1.8" fill={BLUE} />
        <path d="M36.6 9.2l3.6.5-2.3 2.9Z" fill={ROSE} stroke={ROSE} strokeWidth="0.6" strokeLinejoin="round" />
      </>;
  }
}
