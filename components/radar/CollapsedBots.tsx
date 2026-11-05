import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { StageFace, type StagePose } from "./StageFace";
import { botStyle } from "./bots";
import { useRoving } from "./useRoving";

export interface CollapsedBot {
  key: string;
  name: string;
  pose: StagePose;
  status: string;
  needs: number;
  unread: boolean;
  current: boolean;
  threadId: string;
}

type Place =
  | { kind: "rail"; top: number; bottom: number; width: number }
  | { kind: "toggle"; x: number; y: number }
  | null;

function hiddenNow(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.right <= 0 || box.left >= window.innerWidth) return true;
  return getComputedStyle(element).visibility === "hidden";
}

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth;
}

function measure(): Place {
  const rail = document.querySelector('[data-sidebar-navigation-placement="rail"]');
  if (visible(rail)) {
    const box = rail.getBoundingClientRect();
    const half = window.innerHeight / 2;
    const tops = Array.from(document.querySelectorAll("button:not(.radar-rail-bot), a")).filter(visible).map(node => node.getBoundingClientRect())
      .filter(r => r.left >= box.left - 1 && r.right <= box.right + 1);
    const above = tops.filter(r => r.bottom < half).reduce((max, r) => Math.max(max, r.bottom), box.top + 48);
    const below = tops.filter(r => r.top >= half).reduce((min, r) => Math.min(min, r.top), window.innerHeight - 8);
    return { kind: "rail", top: Math.round(above + 10), bottom: Math.round(window.innerHeight - below + 8), width: Math.round(box.width) };
  }
  const toggle = document.querySelector('button[aria-label^="Toggle sidebar"]');
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
  return [bot.name, bot.needs ? `${bot.needs} ${bot.needs === 1 ? "thing needs" : "things need"} you` : "", bot.unread ? "new reply" : "", bot.status].filter(Boolean).join(", ");
}

export function CollapsedBots({ root, bots, scope, onOpen }: {
  root: RefObject<HTMLElement | null>;
  bots: readonly CollapsedBot[];
  scope?: string;
  onOpen: (threadId: string) => void;
}) {
  const place = useCollapsedPlace(root);
  const list = useRef<HTMLElement>(null);
  const roving = useRoving(list, { item: ".radar-rail-bot", row: ".radar-rail-bot", preferred: bots.find(bot => bot.current)?.key ?? null });
  if (!place) return null;
  if (place.kind === "toggle") {
    const needs = bots.reduce((sum, bot) => sum + bot.needs, 0);
    const unread = bots.filter(bot => bot.unread).length;
    if (!needs && !unread) return null;
    const label = [needs ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you` : "", unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : ""].filter(Boolean).join(", ");
    return createPortal(<span className="radar-toggle-badge" data-bb-plugin={scope} data-tone={needs ? "needs" : "unread"} role="status" aria-label={`Bots: ${label}`}
      style={{ left: place.x - 12, top: place.y - 4 } as CSSProperties}>{needs ? needs : ""}</span>, document.body);
  }
  return createPortal(<nav ref={list} className="radar-rail-bots" data-bb-plugin={scope} aria-label="Bots"
    style={{ top: place.top, bottom: place.bottom, width: place.width } as CSSProperties} onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
    {bots.map(bot => <button key={bot.key} type="button" className="radar-rail-bot" data-rove={bot.key} data-current={bot.current || undefined}
      aria-current={bot.current ? "page" : undefined} aria-label={`${spoken(bot)}. Open chat`} title={`${bot.name}\n${bot.status}`}
      style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties} onClick={() => onOpen(bot.threadId)}>
      <StageFace botKey={bot.key} name={bot.name} pose={bot.pose} size={30} bare />
      {bot.needs ? <span className="radar-rail-needs" aria-hidden="true">{bot.needs}</span> : bot.unread ? <span className="radar-rail-unread" aria-hidden="true" /> : null}
    </button>)}
  </nav>, document.body);
}
