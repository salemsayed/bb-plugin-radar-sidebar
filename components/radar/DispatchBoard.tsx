import { BotWorkPanel, type PanelAnchor } from "./panel/BotWorkPanel";
import { useThreadClaims } from "./useThreadClaims";
import { ThreadsSection, threadsSummary } from "./ThreadsSection";
import { useVisibleSurface } from "@/lib/useVisibleSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { flushSync } from "react-dom";
import { needsYou, orderedBots, shortModel, type BotTasksData, type BotTasksBot } from "@/lib/botTasks";
import { asOf, useDeskPress, type DeskMenu } from "./BotsView";
import { botStyle } from "./bots";
import { type OriginalOf } from "./workText";
import { keepHyphens, sentenceEnd } from "./displayText";
import { Icon } from "@/components/ui/icon";
import { useBotWorkers, type WorkerSnapshot } from "./useDispatchWorkers";
import { NeedsSummary, askPlace, boxAnswers, botMenuLabel, needItems, notNowLabel, outsideItems, type NeedItem } from "./NeedsSummary";
import { useGrowSlot, useTouchHold, useWatching } from "./useGrowSlot";
import { CollapsedBots } from "./CollapsedBots";
import { useRoving } from "./useRoving";
import { StageFace } from "./StageFace";
import { useRailHomeCurrent } from "./useRailHomeCurrent";
import { needsCount, rowLook, type RowLook } from "./stage";
import { fitWords } from "./FitLines";
import { requestFill } from "@/lib/composerFill";
import { armAskStrip, clearAskStrip, currentAskStrip } from "@/lib/askStrip";
import { refreshBotTasks, type BotTasksState } from "./useBotTasks";
import { applyNotNow, notNow, useNotNow } from "@/lib/notNow";
import { NotNowToastView } from "./NotNowToast";

export function dispatchModel(model: string) {
  const family = /(?:^|[-/])(sol|astra|terra|opus|fable|sonnet|haiku)(?:[-/]|$)/i.exec(model)?.[1];
  return family ? family[0].toUpperCase() + family.slice(1).toLowerCase() : shortModel(model);
}
const BOT_PAGE = /\/plugins\/orchestrator-mode\/bots\/([a-z0-9-]+)\//;
function useBotPage(watch: boolean): string | null {
  const read = () => BOT_PAGE.exec(location.pathname)?.[1] ?? null;
  const [key, setKey] = useState(read);
  useEffect(() => {
    setKey(read());
    if (!watch) return;
    const timer = setInterval(() => setKey(read()), 800);
    return () => clearInterval(timer);
  }, [watch]);
  return watch ? key : null;
}


const BLOCKED = ["offline", "overdue", "retrying"];
export const IN_CHAT = "Working in chat";
export function dispatchSection(bot: BotTasksBot, running = 0, chatting = false): string {
  if (bot.tasks.some(t => BLOCKED.includes(t.displayState))) return "In motion";
  return running || chatting || bot.unlinked.length || bot.tasks.some(t => ["working", "queued"].includes(t.displayState)) ? "In motion" : "On call";
}

function panelAnchor(row: HTMLElement): PanelAnchor {
  const box = row.getBoundingClientRect();
  const side = row.closest(".stage")?.getBoundingClientRect().right ?? box.right;
  return { x: side + 8, y: box.top, rowCenter: box.top + box.height / 2 };
}

const OPENING_TIMEOUT_MS = 8000;
const STALE_AFTER_MS = 8000;

function StageRow({ bot, look, current, here, marked, opening, unread, needs, panelOpen, onChat, onShowWork }: {
  bot: BotTasksBot; look: RowLook; current: boolean; here: boolean; marked: boolean; opening: boolean; unread: boolean; needs: number; panelOpen: boolean;
  onChat: () => void; onShowWork: (anchor: PanelAnchor) => void;
}) {
  const press = useDeskPress();
  const name = bot.name;
  const needsLabel = needs ? look.pose === "asking" && / for you$/.test(look.line) ? look.line : `${needs} ${needs === 1 ? "question" : "questions"} for you` : "";
  const full = look.ask ?? [look.whole ?? look.line, look.extra].filter(Boolean).join(" · ");
  const when = look.time === "<1m" ? "last reply under a minute ago" : look.time ? `last reply ${look.time} ago` : "";
  const spoken = [needsLabel, unread ? "new reply" : "", full, when, here ? "you are in one of its chats" : ""].filter(Boolean).join(", ");
  const row = (element: Element) => element.closest<HTMLElement>(".stage-row") ?? (element as HTMLElement);
  const [hover, setHover] = useState(false);
  return <div className="stage-row" data-bot={bot.key} data-tone={look.tone} data-kind={look.kind} data-current={current || undefined} data-here={here && !current || undefined}
      data-opening={opening || undefined} data-unread={unread || undefined} data-needs={needs || undefined} data-hover={hover || undefined} data-panel={panelOpen || undefined}
      style={{ "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties} {...press}
      onPointerEnter={event => { if (event.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onContextMenu={event => {
        press.onContextMenu(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onShowWork(panelAnchor(event.currentTarget));
      }}
      onKeyDown={event => {
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
          event.preventDefault();
          onShowWork(panelAnchor(event.currentTarget));
        }
      }}>
      <button type="button" className="stage-chat" data-rove={bot.key} aria-current={marked && (current || here) ? "page" : undefined} aria-busy={opening || undefined}
        aria-label={`${name}: ${sentenceEnd(spoken)} Open chat. Right arrow for tasks and settings`} aria-keyshortcuts="ArrowRight" title={full} onClick={onChat}>
        <span className="stage-figure">
          <StageFace botKey={bot.key} name={bot.name} pose={look.pose} bare />
        </span>
        <span className="stage-copy">
          <span className="stage-head">
            <b>{name}</b>
            {opening ? <span className="stage-opening" aria-hidden="true" />
              : <span className="stage-aside" aria-hidden="true">
                {look.time ? <span className="stage-time" title={look.timeTitle}>{look.time}</span> : null}
                {unread ? <span className="stage-unread-dot" title="New reply" /> : null}
              </span>}
          </span>
          <FitLine look={look} />
        </span>
      </button>
      <button type="button" className="stage-more" tabIndex={-1} aria-haspopup="dialog" aria-expanded={panelOpen}
        aria-label={botMenuLabel(name, needs > 0)}
        title={botMenuLabel(name, needs > 0)}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onShowWork(panelAnchor(row(event.currentTarget))); }}>
        <Icon name="MoreHorizontal" aria-hidden="true" />
      </button>
    </div>;
}

let lineCanvas: HTMLCanvasElement | null = null;
const MARK_PX = 10;

function lineWidth(text: string, font: string): number {
  lineCanvas ??= document.createElement("canvas");
  const context = lineCanvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

const KEEP_WORD = /[\d#!@/\u2192]|^(?:no|not|never|without|un\w+)$/i;

export function shorterForms(line: string): string[] {
  const split = /^([^:]{2,24}:\s)(.+)$/.exec(line);
  const lead = split?.[1] ?? "";
  const words = (split?.[2] ?? line).split(" ");
  if (words.length < 3 || words.some(word => !/^[\p{L}'\u2019-]+$/u.test(word))) return [];
  if (words.length > 7) return [];
  const forms: { text: string; first: boolean }[] = [];
  const free = words.length - 1;
  for (let mask = 1; mask < 1 << free; mask++) {
    const kept = words.filter((word, i) => i === free || !(mask & 1 << i));
    const dropped = words.filter((word, i) => i < free && mask & 1 << i);
    if (kept.length < 2 || dropped.some(word => KEEP_WORD.test(word))) continue;
    const text = kept.join(" ");
    forms.push({ text: `${lead}${text[0]!.toUpperCase()}${text.slice(1)}`, first: !(mask & 1) });
  }
  return forms.sort((a, b) => b.text.length - a.text.length || Number(b.first) - Number(a.first)).map(form => form.text);
}

function FitLine({ look }: { look: RowLook }) {
  const ref = useRef<HTMLSpanElement>(null);
  const options = useMemo(() => [look.line, ...(look.alts ?? [])], [look.line, look.alts]);
  const [pick, setPick] = useState(0);
  const [cut, setCut] = useState<string | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) { setPick(0); setCut(null); return; }
    const measure = () => {
      const style = getComputedStyle(box);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = box.clientWidth - (look.tone === "ask" || look.tone === "busy" || look.tone === "blocked" ? MARK_PX : 0);
      const fits = (option: string) => lineWidth(option, font) <= room;
      const whole = options.findIndex(option => !/\u2026$/.test(option) && fits(option));
      if (whole >= 0 || room <= 0) { setPick(Math.max(whole, 0)); setCut(null); return; }
      const plain = options.filter(option => !/\u2026$/.test(option));
      const narrowest = [...plain].sort((a, b) => lineWidth(a, font) - lineWidth(b, font))[0] ?? options[0]!;
      const shorter = look.exact ? undefined : plain.flatMap(shorterForms).find(fits);
      if (shorter) { setCut(shorter); return; }
      if (look.bare && fits(look.bare)) { setCut(look.bare); return; }
      const at = options.findIndex(fits);
      setPick(at >= 0 ? at : 0);
      setCut(at >= 0 ? null : fitWords(narrowest, fits));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    document.fonts?.addEventListener("loadingdone", measure);
    return () => { live = false; observer.disconnect(); document.fonts?.removeEventListener("loadingdone", measure); };
  }, [options, look.tone, look.exact, look.bare]);
  const said = look.whole ?? look.line;
  const shown = cut ?? options[pick] ?? look.line;
  return <span className="stage-line" ref={ref} title={shown !== said ? said : undefined}><bdi>{keepHyphens(shown)}</bdi></span>;
}

function botOfThread(threadId: string, data: BotTasksData, threads: ReadonlyMap<string, PluginSidebarThread>): string | undefined {
  const byCoordinator = new Map(data.bots.map(b => [b.coordinatorThreadId, b.name]));
  let id: string | null | undefined = threadId;
  for (let hop = 0; id && hop < 4; hop++) {
    const name = byCoordinator.get(id);
    if (name) return name;
    const thread = threads.get(id);
    id = thread?.lifecycleOwnerThreadId ?? thread?.parentThreadId;
  }
  return undefined;
}

function ownerOf(threadId: string, data: BotTasksData, snapshot: WorkerSnapshot, threads: ReadonlyMap<string, PluginSidebarThread>): string | null {
  const direct = (id: string) => data.bots.find(b => b.coordinatorThreadId === id || b.desks.some(desk => desk.threadId === id)
    || b.tasks.some(task => task.conversationThreadId === id || task.needs?.threadId === id || (snapshot.byTask[task.id] ?? []).some(a => a.threadId === id))
    || (snapshot.byBot[b.key] ?? []).some(a => a.threadId === id))?.key;
  let id: string | null | undefined = threadId;
  for (let hop = 0; id && hop < 4; hop++) {
    const key = direct(id);
    if (key) return key;
    const thread = threads.get(id);
    id = thread?.lifecycleOwnerThreadId ?? thread?.parentThreadId;
  }
  return null;
}


export function DispatchBoard({ data: raw, state, activeThreadId, isCompactViewport, now, onOpen, onShowThreads, unreadChats }: {
  data: BotTasksData; state: BotTasksState; activeThreadId: string | null; isCompactViewport: boolean; now: number; onOpen: (id: string, messageSeq?: number) => void; onShowThreads: () => void; deskMenu?: DeskMenu; unreadChats?: ReadonlySet<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const fresh = state.status !== "loading";
  const held = useRef<BotTasksData | null | undefined>(undefined);
  if (held.current === undefined) held.current = state.cached ? raw : null;
  if (fresh) held.current = null;
  const later = useNotNow();
  const data = applyNotNow(held.current ?? raw, later);
  const { threads } = experimental_useSidebarThreads();
  const byId = useMemo(() => new Map(threads.map(thread => [thread.id, thread])), [threads]);
  const visible = useVisibleSurface(root);
  const snapshot = useBotWorkers(data, visible);
  const [sheet, setSheet] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PanelAnchor | undefined>(undefined);
  const [focusDesks, setFocusDesks] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [pointerIn, setPointerIn] = useState(false);
  const touchIn = useTouchHold(root);
  const watching = useWatching(visible);
  const slot = useRef<HTMLDivElement>(null);
  const slotInner = useRef<HTMLDivElement>(null);
  useGrowSlot(slot, slotInner);
  const [keysIn, setKeysIn] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const inside = (target: EventTarget | null) => target instanceof Node && !!root.current?.contains(target);
  useEffect(() => {
    if (state.status !== "loading") { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), Math.max(0, STALE_AFTER_MS - (Date.now() - mountedAt)));
    return () => clearTimeout(timer);
  }, [state.status, mountedAt]);
  useEffect(() => {
    if (!pointerIn) return;
    const check = (event: PointerEvent) => { if (!inside(event.target)) setPointerIn(false); };
    const away = () => setPointerIn(false);
    const blurred = () => setPointerIn(!!root.current?.matches(":hover"));
    document.addEventListener("pointermove", check, true);
    document.addEventListener("pointerdown", check, true);
    document.documentElement.addEventListener("pointerleave", away);
    window.addEventListener("blur", blurred);
    return () => {
      document.removeEventListener("pointermove", check, true);
      document.removeEventListener("pointerdown", check, true);
      document.documentElement.removeEventListener("pointerleave", away);
      window.removeEventListener("blur", blurred);
    };
  }, [pointerIn]);
  useEffect(() => { if (!later.toast) setPointerIn(value => value && !!root.current?.matches(":hover")); }, [later.toast]);
  const opener = useRef<HTMLElement | null>(null);
  const claims = useThreadClaims();
  const originalOf = useMemo<OriginalOf>(() => {
    const yours = data.bots.flatMap(b => b.tasks).flatMap(t => t.ask && /^You asked/.test(t.ask.label) ? [{ threadId: t.ask.ref.threadId, seq: t.ask.ref.seq, text: t.ask.full ?? t.ask.excerpt }] : []);
    return (threadId, seq, words) => {
      const same = yours.find(o => o.threadId === threadId && o.seq === seq);
      if (same) return same.text;
      if (words.length < 16) return undefined;
      for (const o of yours) { const at = o.text.indexOf(words); if (at >= 0) return o.text.slice(at); }
      return undefined;
    };
  }, [data.bots]);
  useRailHomeCurrent(!!activeThreadId);
  const close = () => { setSheet(null); opener.current?.focus(); };
  useEffect(() => { if (sheet && !data.bots.some(b => b.key === sheet)) setSheet(null); }, [data.bots, sheet]);
  useEffect(() => {
    if (!opening) return;
    if (opening === activeThreadId) { setOpening(null); return; }
    const timer = setTimeout(() => setOpening(null), OPENING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [opening, activeThreadId]);
  const open = (id: string, messageSeq?: number) => { if (id !== activeThreadId) setOpening(id); onOpen(id, messageSeq); };
  const threadNeeds = outsideItems(data, byId);
  const bot = data.bots.find(b => b.key === sheet);
  const showPanel = (key: string, desks: boolean) => (point: PanelAnchor) => {
    opener.current = document.activeElement as HTMLElement;
    setKeyboardOpen(!!opener.current?.matches?.(":focus-visible"));
    setAnchor(point);
    setFocusDesks(desks);
    setSheet(key);
  };
  const currentKey = orderedBots(data).find(b => b.coordinatorThreadId === activeThreadId)?.key ?? null;
  const pageKey = useBotPage(!activeThreadId);
  const hereKey = currentKey ?? (activeThreadId ? ownerOf(activeThreadId, data, snapshot, byId) : pageKey && data.bots.some(b => b.key === pageKey) ? pageKey : null);
  const needMarked = !!activeThreadId && (data.bots.some(b => b.tasks.some(t => t.displayState === "needs" && askPlace(t, b.coordinatorThreadId).threadId === activeThreadId) || b.desks.some(d => needsYou(d) && (d.threadId ?? b.coordinatorThreadId) === activeThreadId)) || threadNeeds.some(item => item.threadId === activeThreadId));
  const unreachable = state.status === "error" || state.cached && state.status === "loading" && slow;
  const retry = () => { setRetrying(true); void refreshBotTasks().finally(() => setRetrying(false)); };
  const staleNote = { asOf: asOf(data.observedAt, now), retrying, onRetry: retry };
  const inlineUndo = !sheet;
  const armItem = (item: NeedItem) => armAskStrip({ key: item.id, threadId: item.threadId, messageSeq: item.messageSeq, question: item.what, title: item.title, options: item.options ?? [], botName: item.botName, askedAt: item.at, ...(item.consequence ? { consequence: item.consequence } : {}), ...(item.recommended ? { recommended: item.recommended } : {}) });
  const roving = useRoving(list, { item: ".stage-chat", row: ".stage-row", side: ".stage-more", preferred: hereKey });
  const scope = root.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin") ?? undefined;
  const loose = threadsSummary(claims.ready ? claims.loose : []);
  const collapsedThreads = { text: loose.text, tone: loose.needs ? "needs" as const : loose.failed ? "failed" as const : loose.loud ? "unread" as const : null, count: claims.ready ? claims.loose.length : null };
  const openAsks = needItems(data).filter(item => item.kind === "ask").map(item => item.id).join("\n");
  useEffect(() => {
    const strip = currentAskStrip();
    if (strip && fresh && !openAsks.split("\n").includes(strip.key)) clearAskStrip(strip.key);
  }, [openAsks, fresh]);
  const rows = orderedBots(data).map(b => {
    const unread = !!unreadChats?.has(b.coordinatorThreadId) && activeThreadId !== b.coordinatorThreadId;
    const workers = snapshot.byBot[b.key] ?? [];
    const look = rowLook(b, { running: workers.length, runningTitle: workers[0]?.title, failedChecks: snapshot.failedChecks, chatting: snapshot.chat.has(b.key), unread, now, lastReply: byId.get(b.coordinatorThreadId)?.latestAttentionAt });
    const current = opening ? opening === b.coordinatorThreadId : activeThreadId === b.coordinatorThreadId;
    return { bot: b, unread, look, current, here: !opening && hereKey === b.key, needs: needsCount(b) };
  });
  return <div className="stage" ref={root}
    onPointerEnter={event => { if (event.pointerType === "mouse" && inside(event.target)) setPointerIn(true); }}
    onPointerLeave={() => setPointerIn(false)}
    onFocus={event => { if (inside(event.target)) setKeysIn((event.target as HTMLElement).matches(":focus-visible")); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeysIn(false); }}>
    <div className="stage-needs-slot" ref={slot}><div ref={slotInner}>
      <NeedsSummary data={data} extra={threadNeeds} hold={pointerIn || keysIn || touchIn} watching={watching} seen={visible} now={now} activeThreadId={activeThreadId} onOpen={(id, seq, item) => { if (item?.kind === "ask" && !item.state) armItem(item); open(id, seq); }}
        onAnswer={(item, label) => { armItem(item); requestFill(item.threadId, label, boxAnswers(item), true, item.id); open(item.threadId, item.messageSeq); }}
        checking={!fresh && !unreachable} cold={!held.current}
        stale={unreachable ? staleNote : null}
        inlineUndo={inlineUndo} undo={inlineUndo ? later.toast : null}
        onMenu={(item, at) => { if (item.botKey) showPanel(item.botKey, true)(panelAnchor(at)); }}
        onNotNow={item => { if (item.notNowKey) void notNow(item.notNowKey, notNowLabel(item)); }}
        parked={id => !!later.pending(id)?.on || data.questions.some(q => q.id === id && q.state === "later")} />
      </div>
    </div>
    <div className="stage-bots" role="list" aria-label="Bots" ref={list} onFocus={roving.onFocus} onKeyDown={event => {
      const first = list.current?.querySelector<HTMLElement>(".stage-chat");
      const above = Array.from(root.current?.querySelectorAll<HTMLElement>(".stage-needs-item") ?? []).at(-1);
      if (event.key === "ArrowUp" && above && event.target === first) { event.preventDefault(); above.focus(); return; }
      roving.onKeyDown(event);
    }}>
    {rows.map(({ bot: b, unread, look, current, here, needs }) =>
      <div role="listitem" key={b.key}><StageRow bot={b} look={look} current={current} here={here} marked={!needMarked} opening={opening === b.coordinatorThreadId} unread={unread} needs={needs} panelOpen={sheet === b.key}
        onChat={() => open(b.coordinatorThreadId)}
        onShowWork={showPanel(b.key, needs > 0)} /></div>)}
    </div>
    {data.notFiled.length ? <button className="dispatch-unfiled" onClick={onShowThreads}>{data.notFiled.length} not filed · All threads</button> : null}
    <ThreadsSection activeThreadId={activeThreadId} now={now} onOpen={open} onShowAll={onShowThreads} />
    <CollapsedBots root={root} scope={scope} onOpen={open} threads={collapsedThreads} bots={rows.map(({ bot: b, unread, look, current, here, needs }) => ({
      key: b.key, name: b.name, pose: look.pose, status: look.ask ?? [look.whole ?? look.line, look.extra].filter(Boolean).join(" · "), needs, unread, working: look.tone === "busy", current, here, threadId: b.coordinatorThreadId,
    }))} />
    {bot ? <BotWorkPanel key={`${bot.key}:${focusDesks}`} bot={bot} originalOf={originalOf} askerOf={threadId => botOfThread(threadId, data, byId) ?? data.bots.find(b => b.key === ownerOf(threadId, data, snapshot, byId))?.name} anchor={anchor} focusNeeds={focusDesks} keyboard={keyboardOpen} snapshot={snapshot} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport} now={now}
      onShowThreads={onShowThreads}
      scope={scope}
      onNavigate={(id, messageSeq) => { flushSync(() => setSheet(null)); opener.current?.focus(); open(id, messageSeq); }} onClose={close} /> : null}
    <NotNowToastView toast={later.toast} scope={scope} layout={sheet ?? ""} inline={inlineUndo} />
  </div>;
}
