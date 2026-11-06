import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { StageFace, type StagePose } from "./StageFace";
import { botStyle } from "./bots";
import { useRoving } from "./useRoving";
import { OPEN_THREADS_EVENT, THREADS_OPEN_KEY } from "./ThreadsSection";
import { writeStored } from "./useListSettings";
import { Isolated } from "./Isolated";

export interface CollapsedBot {
  key: string;
  name: string;
  pose: StagePose;
  status: string;
  needs: number;
  unread: boolean;
  working?: boolean;
  current: boolean;
  here?: boolean;
  threadId: string;
}

export interface CollapsedThreads {
  text: string;
  tone: "needs" | "failed" | "unread" | null;
  count: number | null;
}

const OWN_INERT = "data-radar-inert";
const RAIL = '[data-sidebar-navigation-placement="rail"]';
const TOGGLE = 'button[aria-label^="Toggle sidebar"]';

type Place =
  | { kind: "rail"; top: number; bottom: number; width: number }
  | { kind: "toggle"; x: number; y: number }
  | null;

function hiddenNow(element: HTMLElement): boolean {
  if (element.closest(`[inert]:not([${OWN_INERT}])`)) return true;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.right <= 0 || box.left >= window.innerWidth) return true;
  return getComputedStyle(element).visibility === "hidden";
}

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest("[inert]")) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth;
}

function measure(): Place {
  const rail = document.querySelector(RAIL);
  if (visible(rail)) {
    const box = rail.getBoundingClientRect();
    const half = window.innerHeight / 2;
    const tops = Array.from(document.querySelectorAll("button:not(.radar-rail-bot, .radar-rail-threads), a")).filter(visible).map(node => node.getBoundingClientRect())
      .filter(r => r.left >= box.left - 1 && r.right <= box.right + 1);
    const above = tops.filter(r => r.bottom < half).reduce((max, r) => Math.max(max, r.bottom), box.top + 48);
    const below = tops.filter(r => r.top >= half).reduce((min, r) => Math.min(min, r.top), window.innerHeight - 8);
    return { kind: "rail", top: Math.round(above + 10), bottom: Math.round(window.innerHeight - below + 8), width: Math.round(box.width) };
  }
  const toggle = document.querySelector(TOGGLE);
  if (visible(toggle)) {
    const box = toggle.getBoundingClientRect();
    return { kind: "toggle", x: Math.round(box.right), y: Math.round(box.top) };
  }
  return null;
}

function same(a: Place, b: Place): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function useCollapsedPlace(root: RefObject<HTMLElement | null>): Place {
  const [place, setPlace] = useState<Place>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = hiddenNow(element) ? measure() : null;
        setPlace(previous => same(previous, next) ? previous : next);
      });
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(element);
    window.addEventListener("resize", check);
    document.addEventListener("transitionend", check, true);
    document.addEventListener("click", check, true);
    document.addEventListener("keyup", check, true);
    const timer = setInterval(check, 1500);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", check);
      document.removeEventListener("transitionend", check, true);
      document.removeEventListener("click", check, true);
      document.removeEventListener("keyup", check, true);
      clearInterval(timer);
    };
  }, [root]);
  return place;
}

function spoken(bot: CollapsedBot): string {
  return [bot.name, bot.needs ? `${bot.needs} ${bot.needs === 1 ? "thing needs" : "things need"} you` : "", bot.unread ? "new reply" : "", bot.working ? "working now" : "", bot.status].filter(Boolean).join(", ");
}

function useRailHost(active: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const element = document.createElement("div");
    element.className = "radar-rail-host";
    const attach = () => {
      const target = document.querySelector(RAIL) ?? document.body;
      if (element.parentElement !== target) target.appendChild(element);
    };
    attach();
    const timer = setInterval(attach, 1500);
    setHost(element);
    return () => { clearInterval(timer); element.remove(); setHost(null); };
  }, [active]);
  return host;
}

function useOwnInert(root: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const shell = root.current?.closest<HTMLElement>(".radar-list-shell") ?? root.current;
    if (!shell || !on) return;
    shell.setAttribute(OWN_INERT, "");
    shell.inert = true;
    return () => { shell.inert = false; shell.removeAttribute(OWN_INERT); };
  }, [root, on]);
}

function useNamedToggle(label: string) {
  useEffect(() => {
    if (!label) return;
    const toggle = document.querySelector<HTMLElement>(TOGGLE);
    const before = toggle?.getAttribute("aria-label");
    if (!toggle || !before) return;
    toggle.setAttribute("aria-label", `${before}, ${label}`);
    return () => { toggle.setAttribute("aria-label", before); };
  }, [label]);
}

interface Tip { top: number; left: number; title: string; lines: string[] }

function openThreads() {
  writeStored(THREADS_OPEN_KEY, "open");
  window.dispatchEvent(new Event(OPEN_THREADS_EVENT));
  document.querySelector<HTMLElement>(TOGGLE)?.click();
  setTimeout(() => {
    const header = document.querySelector<HTMLElement>(".radar-threads-toggle");
    header?.scrollIntoView({ block: "nearest" });
    header?.focus({ preventScroll: true });
  }, 400);
}

export function CollapsedBots({ root, bots, threads, scope, onOpen }: {
  root: RefObject<HTMLElement | null>;
  bots: readonly CollapsedBot[];
  threads?: CollapsedThreads;
  scope?: string;
  onOpen: (threadId: string) => void;
}) {
  const place = useCollapsedPlace(root);
  const list = useRef<HTMLElement>(null);
  const badgeId = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const host = useRailHost(place?.kind === "rail");
  useOwnInert(root, place?.kind === "rail");
  const needs = bots.reduce((sum, bot) => sum + bot.needs, 0);
  const unread = bots.filter(bot => bot.unread).length;
  const badgeLabel = [needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "", unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : ""].filter(Boolean).join(", ");
  useNamedToggle(place?.kind === "toggle" ? badgeLabel : "");
  const roving = useRoving(list, { item: ".radar-rail-bot, .radar-rail-threads", row: ".radar-rail-bot, .radar-rail-threads", preferred: bots.find(bot => bot.current || bot.here)?.key ?? null });
  useEffect(() => { if (!place) setTip(null); }, [place]);
  if (!place) return null;
  if (place.kind === "toggle") {
    if (!needs && !unread) return null;
    return createPortal(<span id={badgeId} className="radar-toggle-badge" data-bb-plugin={scope} data-tone={needs ? "needs" : "unread"} aria-hidden="true"
      style={{ left: place.x - 12, top: Math.max(place.y - 4, 4) } as CSSProperties}>{needs ? needs : ""}</span>, document.body);
  }
  const show = (element: HTMLElement, title: string, lines: string[]) => {
    const box = element.getBoundingClientRect();
    setTip({ top: Math.round(box.top + box.height / 2), left: Math.round(place.width + 6), title, lines: lines.filter(Boolean) });
  };
  const hide = () => setTip(null);
  const tipProps = (title: string, lines: string[]) => ({
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") show(event.currentTarget, title, lines); },
    onPointerLeave: hide,
    onFocus: (event: React.FocusEvent<HTMLElement>) => show(event.currentTarget, title, lines),
    onBlur: hide,
  });
  const threadsTip = threads ? (threads.text || (threads.count !== null ? `${threads.count} ${threads.count === 1 ? "thread" : "threads"}` : "")) : "";
  return <>
    {createPortal(<nav ref={list} className="radar-rail-bots" data-bb-plugin={scope} aria-label="Bots"
      style={{ top: place.top, bottom: place.bottom, width: place.width } as CSSProperties} onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
      {bots.map(bot => <button key={bot.key} type="button" className="radar-rail-bot" data-rove={bot.key} data-current={bot.current || undefined} data-here={bot.here && !bot.current || undefined}
        aria-current={bot.current || bot.here ? "page" : undefined} aria-label={`${spoken(bot).replace(/[.\s]+$/, "")}. Open chat`}
        style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties} onClick={() => { hide(); onOpen(bot.threadId); }}
        {...tipProps(bot.name, [[bot.needs ? `${bot.needs} ${bot.needs === 1 ? "thing needs" : "things need"} you` : "", bot.unread ? "new reply" : ""].filter(Boolean).join(" · ").replace(/^n/, "N"), bot.status])}>
        <StageFace botKey={bot.key} name={bot.name} pose={bot.pose} size={30} bare />
        {bot.needs ? <span className="radar-rail-needs" aria-hidden="true">{bot.needs}</span> : null}
        {bot.unread ? <span className="radar-rail-unread" data-with-needs={bot.needs ? "" : undefined} aria-hidden="true" /> : null}
        {bot.working ? <span className="radar-rail-working" aria-hidden="true" /> : null}
      </button>)}
      {threads ? <button type="button" className="radar-rail-threads" data-rove="radar-threads" data-tone={threads.tone ?? undefined}
        aria-label={`Other threads${threadsTip ? `, ${threadsTip}` : ""}. Show in the sidebar`}
        onClick={() => { hide(); openThreads(); }} {...tipProps("Other threads", ["Not run by a bot", threadsTip])}>
        <Icon name="MessageSquare" aria-hidden="true" />
        {threads.tone ? <span className="radar-rail-unread" aria-hidden="true" /> : null}
      </button> : null}
    </nav>, host ?? document.body)}
    {tip ? createPortal(<div className="radar-rail-tip" data-bb-plugin={scope} role="tooltip" style={{ top: tip.top, left: tip.left } as CSSProperties}>
      <b>{tip.title}</b>{tip.lines.map(line => <span key={line}><Isolated text={line} /></span>)}
    </div>, document.body) : null}
  </>;
}
