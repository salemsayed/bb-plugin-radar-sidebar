import { useEffect, useRef, type RefObject } from "react";

export const CREW_BEAT_MS = 320;
export const CREW_MAX_LIVE = 3;
const TURN_BEATS = 16;
const PHASES = 4;

type CrewElement = HTMLElement | SVGElement;
type Part = "root" | "pupils" | "hands";
export type CrewLoop = "typing" | "tick" | "slow-tick";

interface LoopClip { id: string; part: Part; frames: readonly Keyframe[]; beatsPerFrame: number }
interface EnterClip { id: string; part: Part; frames: readonly Keyframe[]; frameMs: number }

const PART_SELECTOR: Record<Exclude<Part, "root">, string> = { pupils: ":scope > .crew-pupils", hands: ":scope > .crew-hands" };

const still: Keyframe = { transform: "none" };
const shift = (x: string): Keyframe => ({ transform: `translateX(${x})` });
const turns = Array.from({ length: 8 }, (_, step): Keyframe => ({ rotate: `${step * 45}deg` }));

const LOOPS: Record<CrewLoop, readonly LoopClip[]> = {
  typing: [
    { id: "crew-loop-bob", part: "root", beatsPerFrame: 1, frames: [still, { transform: "translateY(2.2%)" }] },
    { id: "crew-loop-dart", part: "pupils", beatsPerFrame: 1, frames: [shift("-2.6%"), shift("-2.6%"), shift("-2.6%"), still, shift("2.6%"), shift("2.6%"), shift("2.6%"), still] },
  ],
  tick: [{ id: "crew-loop-tick", part: "root", beatsPerFrame: 1, frames: turns }],
  "slow-tick": [{ id: "crew-loop-tick", part: "root", beatsPerFrame: 2, frames: turns }],
};

const POP: EnterClip = { id: "crew-enter-pop", part: "root", frameMs: 75, frames: [{ transform: "scale(1.1, 0.88)" }, { transform: "scale(0.93, 1.1) translateY(-5%)" }, { transform: "scale(1.04, 0.97)" }, still] };
const ENTERS: Record<string, readonly EnterClip[]> = {
  asking: [POP, { id: "crew-enter-wave", part: "hands", frameMs: 160, frames: [{ transform: "rotate(-12deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(-12deg)" }, { transform: "rotate(6deg)" }, { transform: "rotate(-12deg)" }, still] }],
  done: [{ id: "crew-enter-cheer", part: "root", frameMs: 80, frames: [{ transform: "scale(1.12, 0.86)" }, { transform: "scale(0.92, 1.1) translateY(-16%)" }, { transform: "translateY(-20%)" }, { transform: "scale(0.96, 1.05) translateY(-9%)" }, { transform: "scale(1.08, 0.92)" }, still] }],
  blocked: [{ id: "crew-enter-shudder", part: "root", frameMs: 80, frames: [{ transform: "translateX(-5%) rotate(-3deg)" }, { transform: "translateX(5%) rotate(3deg)" }, { transform: "translateX(-3%) rotate(-2deg)" }, still] }],
};

interface Member {
  element: CrewElement;
  width: number;
  loop: CrewLoop | null;
  visible: boolean;
  entering: boolean;
  playing: Animation[];
}

const members = new Map<CrewElement, Member>();
let observer: IntersectionObserver | null = null;
let reduced: MediaQueryList | null = null;
let enabled = true;
let turn = 0;
let turnTimer: ReturnType<typeof setTimeout> | null = null;
let electing = false;

function motionAllowed(): boolean {
  return enabled && document.visibilityState === "visible" && !reduced?.matches;
}

function inDocumentOrder(a: Member, b: Member): number {
  return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function partOf(element: CrewElement, part: Part): Element | null {
  return part === "root" ? element : element.querySelector(PART_SELECTOR[part]);
}

function held(frames: readonly Keyframe[]): Keyframe[] {
  return [...frames.map((frame, index) => ({ ...frame, offset: index / frames.length, easing: "step-end" })), { ...frames[0], offset: 1 }];
}

function startLoop(member: Member, phase: number): void {
  if (!member.loop) return;
  for (const clip of LOOPS[member.loop]) {
    const target = partOf(member.element, clip.part);
    if (!target) continue;
    const frameMs = CREW_BEAT_MS * clip.beatsPerFrame;
    const lead = phase * Math.ceil(clip.frames.length / PHASES);
    const animation = target.animate(held(clip.frames), { duration: frameMs * clip.frames.length, iterations: Infinity, delay: -lead * frameMs });
    animation.id = clip.id;
    animation.startTime = 0;
    member.playing.push(animation);
  }
}

function stopLoop(member: Member): void {
  for (const animation of member.playing) animation.cancel();
  member.playing = [];
}

function chosen(candidates: Member[]): Member[] {
  if (candidates.length <= CREW_MAX_LIVE) return candidates;
  const widest = Math.max(...candidates.map(member => member.width));
  const narrowest = Math.min(...candidates.map(member => member.width));
  const front = widest > narrowest ? candidates.filter(member => member.width === widest).sort(inDocumentOrder).slice(0, CREW_MAX_LIVE) : [];
  const rest = candidates.filter(member => !front.includes(member)).sort(inDocumentOrder);
  const open = CREW_MAX_LIVE - front.length;
  const first = rest.length ? turn % rest.length : 0;
  return [...front, ...Array.from({ length: Math.min(open, rest.length) }, (_, index) => rest[(first + index) % rest.length]!)];
}

function elect(): void {
  electing = false;
  const candidates = motionAllowed() ? [...members.values()].filter(member => member.loop && member.visible) : [];
  const next = chosen(candidates);
  for (const member of members.values()) {
    if (member.playing.length && !next.includes(member)) stopLoop(member);
  }
  next.forEach((member, index) => {
    if (!member.playing.length && !member.entering) startLoop(member, index % PHASES);
  });
  const waiting = candidates.length > CREW_MAX_LIVE;
  if (waiting && turnTimer === null) {
    turnTimer = setTimeout(() => { turnTimer = null; turn += 1; elect(); }, TURN_BEATS * CREW_BEAT_MS);
  } else if (!waiting && turnTimer !== null) {
    clearTimeout(turnTimer);
    turnTimer = null;
  }
}

function requestElection(): void {
  if (electing) return;
  electing = true;
  queueMicrotask(elect);
}

function start(): void {
  if (observer) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const member = members.get(entry.target as CrewElement);
      if (!member) continue;
      member.visible = entry.isIntersecting;
      member.width = Math.round(entry.boundingClientRect.width);
    }
    requestElection();
  });
  reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced.addEventListener("change", requestElection);
  document.addEventListener("visibilitychange", requestElection);
}

function join(element: CrewElement): () => void {
  start();
  const member: Member = { element, width: 0, loop: null, visible: false, entering: false, playing: [] };
  members.set(element, member);
  observer!.observe(element);
  return () => {
    observer!.unobserve(element);
    members.delete(element);
    stopLoop(member);
    requestElection();
  };
}

function setLoop(element: CrewElement, loop: CrewLoop | null): void {
  const member = members.get(element);
  if (!member || member.loop === loop) return;
  stopLoop(member);
  member.loop = loop;
  requestElection();
}

function playEnter(element: CrewElement, pose: string): void {
  const member = members.get(element);
  if (!member?.visible || !motionAllowed()) return;
  stopLoop(member);
  member.entering = true;
  const entrance = (ENTERS[pose] ?? [POP]).flatMap(clip => {
    const target = partOf(element, clip.part);
    if (!target) return [];
    const animation = target.animate(held(clip.frames), { duration: clip.frameMs * clip.frames.length });
    animation.id = clip.id;
    return [animation];
  });
  void Promise.allSettled(entrance.map(animation => animation.finished)).then(() => {
    member.entering = false;
    requestElection();
  });
}

export function setCrewMotionEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  requestElection();
}

export function useCrewMotion(ref: RefObject<CrewElement | null>, { loop, pose }: { loop: CrewLoop | null; pose?: string }): void {
  const joined = useRef<{ element: CrewElement; leave: () => void } | null>(null);
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    const element = ref.current;
    if (joined.current?.element !== element) {
      joined.current?.leave();
      joined.current = element ? { element, leave: join(element) } : null;
    }
    if (element) setLoop(element, loop);
  });
  useEffect(() => () => {
    joined.current?.leave();
    joined.current = null;
  }, []);
  useEffect(() => {
    const before = seen.current;
    seen.current = pose;
    if (pose !== undefined && before !== undefined && before !== pose && ref.current) playEnter(ref.current, pose);
  }, [ref, pose]);
}
