import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./BotAvatar";
import { RadarBotHoverCard } from "./RadarBotHoverCard";
import { botFamily, botRailState, botWorkers } from "./botScope";
import { botStyle, STATE_LABELS, type Pulse, type RosterBot } from "./bots";
import { moveRailFocus, type RailTip } from "./railTooltip";

/** Bot shortcuts belong to our thread list; BB owns the navigation rail. */
export function RadarBotSwitcher({ bots, threads, pulses, scope, activeThreadId, compact, motion, loudUnread, onSelect, onClear, onNavigate }: {
  bots: readonly RosterBot[];
  threads: readonly PluginSidebarThread[];
  pulses: ReadonlyMap<string, Pulse>;
  scope: string | null;
  activeThreadId: string | null;
  compact: boolean;
  motion: boolean;
  loudUnread: boolean;
  onSelect: (bot: RosterBot) => void;
  onClear: () => void;
  onNavigate: () => void;
}) {
  const [tip, setTip] = useState<RailTip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const suppressFocus = useRef(false);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => { cancel(); setTip(null); };
  const leave = () => {
    cancel();
    timer.current = setTimeout(() => setTip(null), 120);
  };
  const reveal = (button: HTMLButtonElement, bot: RosterBot) => {
    cancel();
    if (compact || suppressFocus.current) {
      suppressFocus.current = false;
      return;
    }
    trigger.current = button;
    const rect = button.getBoundingClientRect();
    timer.current = setTimeout(() => setTip({ key: bot.key, botKey: bot.key, top: rect.top + rect.height / 2, left: rect.right + 10 }), 250);
  };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (compact) {
      if (timer.current !== null) clearTimeout(timer.current);
      setTip(null);
    }
  }, [compact]);
  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && (trigger.current?.contains(event.target) ||
        document.querySelector("[data-radar-bot-hover]")?.contains(event.target))) return;
      setTip(null);
    };
    const reposition = () => setTip(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", reposition);
    };
  }, [tip]);

  const hovered = bots.find(bot => bot.key === tip?.botKey);
  if (bots.length === 0) return null;
  return <>
    <div role="group" aria-label="Bot shortcuts" className="radar-bot-switcher" onKeyDown={event => {
      if (event.key === "Escape") { close(); return; }
      if (event.key === "ArrowDown" && tip) {
        const link = document.querySelector<HTMLAnchorElement>("[data-radar-bot-hover] a");
        if (link) { event.preventDefault(); cancel(); link.focus(); return; }
      }
      moveRailFocus(event);
    }}>
      {/* Text, not a house: BB's rail already has Home, which only switches the sidebar to this list. */}
      <button type="button" className={cn("radar-bot-shortcut radar-bot-shortcut-all", scope === null && "radar-bot-shortcut-selected")}
        aria-label="All threads" aria-pressed={scope === null} title="All threads: clear the bot filter"
        onClick={() => { close(); onClear(); }}>All</button>
      {bots.map(bot => {
        const state = botRailState(threads, bot, pulses.get(bot.current) ?? null);
        const label = STATE_LABELS[state];
        const unread = (bot.unseenAttention ?? 0) > 0 || botFamily(threads, bot).some(thread => thread.isUnread);
        const workers = botWorkers(threads, bot);
        const releases = scope === bot.key && activeThreadId === bot.current;
        const details = `${label.text}${unread ? " · Unread reply" : ""} · ${workers.length} worker${workers.length === 1 ? "" : "s"}`;
        return <button key={bot.key} type="button"
          className={cn("radar-bot-shortcut", scope === bot.key && "radar-bot-shortcut-selected", unread && loudUnread && "radar-bot-shortcut-unread")}
          style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties}
          aria-label={`${bot.name}, ${details}: ${releases ? "show all threads" : "open coordinator and its workers"}`}
          aria-pressed={scope === bot.key}
          aria-haspopup={!compact ? "dialog" : undefined}
          aria-expanded={!compact ? tip?.botKey === bot.key : undefined}
          aria-controls={tip?.botKey === bot.key ? "radar-bot-hover-card" : undefined}
          title={`${bot.name}: ${details}`}
          onClick={() => { close(); if (releases) onClear(); else onSelect(bot); }}
          onPointerEnter={event => { if (event.pointerType !== "touch") reveal(event.currentTarget, bot); }}
          onPointerLeave={leave}
          onFocus={event => reveal(event.currentTarget, bot)}
          onBlur={event => { if (!(event.relatedTarget instanceof Node) || !document.querySelector("[data-radar-bot-hover]")?.contains(event.relatedTarget)) leave(); }}>
          <BotAvatar botKey={bot.key} name={bot.name} state={state} unread={unread} motion={motion} />
        </button>;
      })}
    </div>
    {tip && hovered ? createPortal(<div>
      <RadarBotHoverCard bot={hovered} coordinator={threads.find(thread => thread.id === hovered.current)}
        pulse={pulses.get(hovered.current) ?? null} workers={botWorkers(threads, hovered)}
        state={botRailState(threads, hovered, pulses.get(hovered.current) ?? null)} tip={tip}
        onKeepOpen={cancel} onLeave={leave} onClose={() => { close(); suppressFocus.current = true; trigger.current?.focus(); }}
        onNavigate={() => { close(); onNavigate(); }}
        onViewWorkers={() => { close(); onSelect(hovered); }} motion={motion} />
    </div>, document.body) : null}
  </>;
}
