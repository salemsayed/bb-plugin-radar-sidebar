import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import type { BotTasksBot } from "@/lib/botTasks";
import { automationsHref } from "../automationsLink";
import { useCoordinatorTarget } from "../BotDeskMenu";
import { BotMenu } from "../BotMenu";
import { BotTaskFace } from "../BotsView";
import { botStyle } from "../bots";
import { ago } from "../elapsed";
import type { WorkerSnapshot } from "../useDispatchWorkers";
import { useThreadClaims } from "../useThreadClaims";
import type { OriginalOf } from "../workText";
import { DeskAskCard, TaskAskCard, type Navigate, type Park } from "./AskCard";
import { DoneSection } from "./DoneSection";
import { panelModel, panelTally, type WorkItem } from "./panelModel";
import { GROUP_TITLE, type Group } from "./status";
import { StatusMark } from "./StatusMark";
import type { DetailContext } from "./taskDetail";
import { WorkRow } from "./WorkRow";

export interface PanelAnchor { x: number; y: number; rowCenter?: number; align?: "start" | "end" }

const PANEL_WIDTH = 400;
const EDGE = 12;
const PREFERRED_PANEL = 760;
const SETTLE_MS = 450;
const TALLY_MARK = { needs: "ask", stuck: "stuck", working: "working", waiting: "waiting", later: "later", done: "done" } as const;

function anchoredStyle(anchor: PanelAnchor): CSSProperties {
  const left = anchor.align === "end" ? anchor.x - PANEL_WIDTH : anchor.x;
  const bottom = window.innerHeight - EDGE;
  const wanted = Math.min(PREFERRED_PANEL, bottom - EDGE);
  const top = Math.max(EDGE, Math.min(anchor.y - 6, bottom - wanted));
  const caret = anchor.rowCenter !== undefined ? Math.min(Math.max(anchor.rowCenter - top, 24), bottom - top - 24) : undefined;
  return {
    position: "fixed",
    left: `clamp(${EDGE}px, ${left}px, calc(100vw - ${PANEL_WIDTH + EDGE}px))`,
    top: `${top}px`,
    maxHeight: `${bottom - top}px`,
    ...(caret !== undefined ? { "--caret-y": `${caret}px` } : {}),
  } as CSSProperties;
}

function trapTab(panel: HTMLElement, event: React.KeyboardEvent): void {
  const stops = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
  const first = stops[0], last = stops.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

function Section({ group, title, aside, children }: { group: Group | "yours"; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="panel-section" data-group={group} aria-label={title}>
    <header className="panel-section-head"><h3>{title}</h3>{aside !== undefined ? <span>{aside}</span> : null}</header>
    {children}
  </section>;
}

export function BotWorkPanel({ bot, anchor, focusNeeds = false, keyboard = false, snapshot, activeThreadId, isCompactViewport, now, scope, onNavigate, onClose, onShowThreads, askerOf, originalOf }: {
  bot: BotTasksBot; anchor?: PanelAnchor; askerOf?: (threadId: string) => string | undefined; originalOf?: OriginalOf; focusNeeds?: boolean; keyboard?: boolean; snapshot: WorkerSnapshot; activeThreadId: string | null; isCompactViewport: boolean; now: number; scope?: string;
  onNavigate: Navigate; onClose: () => void; onShowThreads?: () => void;
}) {
  const claims = useThreadClaims();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const target = useCoordinatorTarget(bot.coordinatorThreadId);
  const drag = useRef<number | null>(null);
  const quietUntil = useRef(isCompactViewport ? performance.now() + SETTLE_MS : 0);
  useEffect(() => {
    const firstAsk = focusNeeds && keyboard ? panel.current?.querySelector<HTMLElement>(".panel-ask-question") : null;
    if (firstAsk) (firstAsk as HTMLElement & { focus(options: FocusOptions & { focusVisible?: boolean }): void }).focus({ preventScroll: true, focusVisible: true });
    else panel.current?.focus({ preventScroll: true });
  }, [focusNeeds, keyboard]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.activeElement instanceof Node && panel.current?.contains(document.activeElement)) return;
      if (document.querySelector('[role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const settle = window.setTimeout(() => {
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable;
      if (!active || active === document.body || !panel.current?.contains(active) && !typing) panel.current?.focus({ preventScroll: true });
    }, SETTLE_MS + 50);
    return () => { document.removeEventListener("keydown", onKey); window.clearTimeout(settle); };
  }, []);
  useEffect(() => {
    if (!isCompactViewport) return;
    const elements = [document.documentElement, document.body, document.querySelector<HTMLElement>(".radar-list-body")].filter((node): node is HTMLElement => !!node);
    const previous = elements.map(node => node.style.overflow);
    elements.forEach(node => { node.style.overflow = "hidden"; });
    return () => elements.forEach((node, i) => { node.style.overflow = previous[i]!; });
  }, [isCompactViewport]);

  const model = panelModel({ bot, snapshot, now, yours: claims.byBot[bot.key] ?? [] });
  const tally = panelTally(model);
  const context: DetailContext = { now, botName: bot.name, askerOf, originalOf };
  const openCount = model.asks.length + model.deskAsks.length + model.stuck.length + model.working.length + model.waiting.length + model.later.length + model.yours.length;
  const lastDone = model.doneToday[0] ?? model.doneEarlier[0];
  const park: Park = (from, act) => {
    const holder = from.closest<HTMLElement>("[data-item]");
    const siblings = Array.from(holder?.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-item]") ?? []);
    const at = holder ? siblings.indexOf(holder) : -1;
    const next = siblings[at + 1] ?? siblings[at - 1];
    quietUntil.current = performance.now() + SETTLE_MS;
    void act();
    requestAnimationFrame(() => ((next?.isConnected ? next.querySelector<HTMLElement>("button") : null) ?? panel.current)?.focus({ preventScroll: false }));
  };
  const jump = (group: Group) => body.current?.querySelector<HTMLElement>(`[data-group="${group}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const isCurrent = (item: WorkItem) => !!activeThreadId && (item.kind === "task" ? item.task.conversationThreadId === activeThreadId : item.kind === "desk" ? item.desk.threadId === activeThreadId : item.threadId === activeThreadId);
  const rows = (items: readonly WorkItem[]) => <ul className="panel-rows">{items.map(item => <WorkRow key={item.key} item={item} bot={bot} context={context} current={isCurrent(item)} onNavigate={onNavigate} onPark={park} />)}</ul>;
  const workersNote = model.workers ? `${model.workers} ${model.workers === 1 ? "worker" : "workers"} running` : undefined;
  const busy = (model.workers ?? 0) > 0 || model.chatting || model.working.length > 0;
  const anchored = anchor && !isCompactViewport;
  const quietLine = model.chatting ? "Nothing else is open."
    : lastDone ? `Last one finished ${ago(lastDone.at, now)}.`
    : "Ask for something in its chat and it shows up here.";

  return createPortal(<div className={`dispatch-overlay${isCompactViewport ? " dispatch-phone" : ""}${anchored ? " dispatch-anchored" : ""}`} data-bb-portaled-overlay="" data-bb-plugin={scope}
    onClickCapture={event => { if (performance.now() < quietUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dispatch-panel" data-caret={anchored && anchor?.rowCenter !== undefined || undefined} style={{ "--bot-hue": botStyle(bot.key, bot.name).hue, ...(anchored ? anchoredStyle(anchor) : {}) } as CSSProperties} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${bot.name}: tasks and desks`}
      onKeyDown={event => {
        if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) return;
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") trapTab(panel.current, event);
      }}>
      {isCompactViewport ? <button className="dispatch-grabber" aria-label="Close work panel" onClick={onClose} onPointerDown={event => { drag.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { if (drag.current !== null && event.clientY - drag.current > 50) onClose(); drag.current = null; }}><span /></button> : null}
      <header className="dispatch-panel-head">
        <span className="dispatch-panel-face"><BotTaskFace bot={bot} size={40} state={model.stuck.length ? "failed" : busy ? "working" : undefined} /></span>
        <div><h2>{bot.name}</h2></div>
        <button className="dispatch-close" aria-label={`Close ${bot.name}`} onClick={onClose}><Icon name="X" aria-hidden="true" /></button>
      </header>
      {tally.length ? <p className="panel-tally">{tally.map(part => <button key={part.group} type="button" className="panel-tally-part" data-group={part.group} title={`Jump to ${GROUP_TITLE[part.group]}`} onClick={() => jump(part.group)}><StatusMark mark={TALLY_MARK[part.group]} /><b>{part.count}</b> {part.label}</button>)}</p>
        : <p className="panel-tally panel-tally-quiet">{model.chatting ? "Replying in chat" : "Nothing open"}</p>}
      <nav className="dispatch-panel-actions" aria-label={`${bot.name} actions`}>
        {activeThreadId === bot.coordinatorThreadId ? null : <button className="dispatch-chat-pill" onClick={() => onNavigate(bot.coordinatorThreadId)}><Icon name="MessageSquare" aria-hidden="true" />Chat</button>}
        <a className="dispatch-automations" href={automationsHref(bot.key)} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose(); }}><Icon name="Clock" aria-hidden="true" />Automations</a>
        <BotMenu thread={target} botName={bot.name} onShowThreads={() => { window.dispatchEvent(new Event("radar:show-all-threads")); onShowThreads?.(); }} onClose={onClose} />
      </nav>
      <div className="dispatch-panel-body" ref={body}>
        {model.asks.length || model.deskAsks.length ? <Section group="needs" title={GROUP_TITLE.needs} aside={model.asks.length + model.deskAsks.length}>
          <div className="panel-asks">
            {model.asks.map(item => <TaskAskCard key={item.key} item={item} bot={bot} context={context} current={isCurrent(item)} onNavigate={onNavigate} onPark={park} />)}
            {model.deskAsks.map(item => <DeskAskCard key={item.key} item={item} botKey={bot.key} botName={bot.name} now={now} current={isCurrent(item)} onNavigate={onNavigate} onPark={park} />)}
          </div>
        </Section> : null}
        {model.stuck.length ? <Section group="stuck" title={GROUP_TITLE.stuck} aside={model.stuck.length}>{rows(model.stuck)}</Section> : null}
        {model.working.length ? <Section group="working" title={GROUP_TITLE.working} aside={workersNote ?? model.working.length}>{rows(model.working)}</Section> : null}
        {model.waiting.length ? <Section group="waiting" title={GROUP_TITLE.waiting} aside={model.waiting.length}>{rows(model.waiting)}</Section> : null}
        {model.yours.length ? <Section group="yours" title="Started by you" aside={model.yours.length}>{rows(model.yours)}</Section> : null}
        {model.later.length ? <Section group="later" title={GROUP_TITLE.later} aside={model.later.length}>{rows(model.later)}</Section> : null}
        {openCount ? null : <p className="panel-quiet">{quietLine}</p>}
        <DoneSection today={model.doneToday} earlier={model.doneEarlier} now={now} renderRows={rows} />
      </div>
    </div>
  </div>, document.body);
}
