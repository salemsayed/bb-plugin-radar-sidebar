import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { RadarBotHoverCard } from "./RadarBotHoverCard";
import { HugeiconsIcon } from "@hugeicons/react";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import ArrowLeftDoubleIcon from "@hugeicons/core-free-icons/ArrowLeftDoubleIcon";
import ArrowRightDoubleIcon from "@hugeicons/core-free-icons/ArrowRightDoubleIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import {
  experimental_Icon as HostIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSettings,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
import {
  CREW_SCOPE,
  setRailScope,
  notifyRailThreadNavigation,
  useValidatedRailScope,
} from "./railScope";
import { useBotRoster } from "./useBotRoster";
import { useThreadPulses } from "./useThreadPulses";
import { botStyle, shortBotName, STATE_LABELS } from "./bots";
import { BotAvatar } from "./BotAvatar";
import { botRailState, botWorkers, rosterRefreshKey } from "./botScope";
import {
  hintFor,
  RowIcon,
  NavigationButton,
  MorePopover,
  type MoreAction,
} from "./navigationControls";
import { RailTooltip, moveRailFocus, type RailTip } from "./railTooltip";
import { useRailHostStructure, useRailMeasurements } from "./railLayout";
import { railHostCss } from "./railHostStyles";
import { setRailNewThread } from "./railNewThread";

const RAIL_WIDE_KEY = "radar-sidebar:rail-wide:v1";

function readRailWide(): boolean {
  try {
    return localStorage.getItem(RAIL_WIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRailWide(wide: boolean): void {
  try {
    localStorage.setItem(RAIL_WIDE_KEY, wide ? "1" : "0");
  } catch {
    // Preference simply won't persist.
  }
}
/**
 * Radar navigation that honors BB's own sidebar arrangement:
 * inline rows and the More popover follow the user's stock "Customize
 * sidebar" order + visibility exactly (server-synced UI preferences), and
 * Keep in sidebar / Move to More writes back to that same store — so
 * arranging in either nav carries over to the other.
 */
function RailNavigationBody({
  isCompactViewport,
  footerHeight = 0,
}: ExperimentalSidebarNavigationProps & { footerHeight: number }) {
  const { items, activeItemId, actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  // The rail is the layout on every viewport; compact only changes what
  // rides on it (no hover tooltips, no wide mode) and the gutter width.
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    itemId: string;
  } | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [wideChoice, setWide] = useState(readRailWide);
  const { values: settingValues } = useSettings();
  const botRail = settingValues?.botRail === true;
  const { threads } = experimental_useSidebarThreads();
  const bots = useBotRoster(botRail, rosterRefreshKey(threads));
  const scope = useValidatedRailScope(bots, botRail);
  const crew = scope === CREW_SCOPE;
  const navigate = useBbNavigate();
  const { threadId: openThreadId } = useBbContext();
  const botRows = useMemo(() => threads.filter(t => bots.some(bot => bot.current === t.id)), [threads, bots]);
  const pulses = useThreadPulses(botRows, botRail);

  const toggleWide = () => {
    setWide((previous) => {
      writeRailWide(!previous);
      return !previous;
    });
  };
  // Wide mode restyles BB's own sidebar markup, so it ships off and needs
  // the plugin setting on, plus the host structure it relies on. Without
  // either, the toggle is hidden and the rail stays narrow.
  const wideAllowed = settingValues?.wideRail === true && !isCompactViewport;
  const hostSupportsWide = useRailHostStructure(railRef);
  const wide = wideChoice && wideAllowed && hostSupportsWide;
  // BB's sidebar is restyled from the rail's own <style> elements below,
  // never by writing to BB's elements, so unmounting releases it.
  const hostCss = useMemo(
    () => railHostCss({ wide, compact: isCompactViewport }),
    [wide, isCompactViewport],
  );
  const hostValuesRef = useRef<HTMLStyleElement | null>(null);

  // Rail tooltip: armed on hover/focus after a short delay, dropped on
  // leave, blur, click, right-click, or when any overlay opens.
  const [tip, setTip] = useState<RailTip | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipTrigger = useRef<HTMLElement | null>(null);
  const keepTip = useCallback(() => {
    if (tipCloseTimer.current !== null) clearTimeout(tipCloseTimer.current);
    tipCloseTimer.current = null;
  }, []);
  const hideTip = useCallback(() => {
    keepTip();
    if (tipTimer.current !== null) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(null);
  }, [keepTip]);
  const leaveBotTip = useCallback(() => {
    if (tipTimer.current !== null) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    keepTip();
    tipCloseTimer.current = setTimeout(() => {
      if (!document.querySelector("[data-radar-bot-hover]")?.contains(document.activeElement)) hideTip();
    }, 180);
  }, [hideTip, keepTip]);
  const closeBotTip = useCallback(() => {
    tipTrigger.current?.focus();
    hideTip();
  }, [hideTip]);
  const showTip = useCallback(
    (
      target: HTMLElement,
      next: Omit<RailTip, "top" | "left">,
      delay: number,
    ) => {
      keepTip();
      tipTrigger.current = target;
      if (tipTimer.current !== null) clearTimeout(tipTimer.current);
      const show = () => {
        tipTimer.current = null;
        const rect = target.getBoundingClientRect();
        setTip({
          ...next,
          top: rect.top + rect.height / 2,
          left: rect.right + 10,
        });
      };
      if (delay === 0) show();
      else tipTimer.current = setTimeout(show, delay);
    },
    [keepTip],
  );
  useEffect(() => hideTip, [hideTip]);
  useEffect(() => {
    if (isCompactViewport) hideTip();
  }, [isCompactViewport, hideTip]);

  useEffect(() => {
    if (!tip?.botKey) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !tipTrigger.current?.contains(event.target) &&
          !document.querySelector("[data-radar-bot-hover]")?.contains(event.target)) hideTip();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || (tipTrigger.current && event.target.contains(tipTrigger.current))) hideTip();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hideTip);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hideTip);
    };
  }, [tip?.botKey, hideTip]);

  // Callbacks and derived lists stay stable across thread updates so the
  // memoized destination buttons below skip rendering.
  const activate = useCallback(
    (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => {
      if (item.isDisabled || item.isLoading) return;
      hideTip();
      setMoreAt(null);
      setMenu(null);
      actions.activate(item.id, { openInSplit });
    },
    [actions, hideTip],
  );
  const closeMore = useCallback(() => setMoreAt(null), []);

  const { inlineDestinations, overflow, newThread } = useMemo(() => {
    const destinations = items.filter(
      (item) => item.action.kind !== "new-thread",
    );
    return {
      inlineDestinations: destinations.filter((item) => item.isVisible),
      overflow: destinations.filter((item) => !item.isVisible),
      newThread: items.find((item) => item.action.kind === "new-thread"),
    };
  }, [items]);

  // No heading of its own: New thread ends the list's header row, and the
  // list shows a bot or crew scope as a removable pill.
  useEffect(() => {
    if (!newThread) return;
    setRailNewThread({
      open: (openInSplit) => activate(newThread, openInSplit),
      label: hintFor(newThread),
      keyShortcuts: newThread.shortcut?.ariaKeyShortcuts,
    });
    return () => setRailNewThread(null);
  }, [newThread, activate]);

  useRailMeasurements(railRef, hostValuesRef, items, bots.length, wide, botRail ? Math.min(560, (bots.length + inlineDestinations.length + 2) * 42 + 20) : 200);

  const overflowActive =
    activeItemId !== null && overflow.some((item) => item.id === activeItemId);

  const openMenu = useCallback(
    (clientX: number, clientY: number, item: ExperimentalSidebarNavigationItem) => {
      hideTip();
      setMenu({ x: clientX, y: clientY, itemId: item.id });
    },
    [hideTip],
  );

  // Tooltip wiring for one rail control. Hover waits briefly so sweeping the
  // pointer down the rail doesn't flicker; keyboard focus shows at once.
  const tipProps = useCallback(
    (next: Omit<RailTip, "top" | "left">) =>
      !isCompactViewport
        ? {
            onPointerEnter: (event: React.PointerEvent<HTMLElement>) =>
              showTip(event.currentTarget, next, 220),
            onPointerLeave: next.botKey ? leaveBotTip : hideTip,
            onFocus: (event: React.FocusEvent<HTMLElement>) =>
              showTip(event.currentTarget, next, 0),
            onBlur: (event: React.FocusEvent<HTMLElement>) => {
              if (next.botKey && event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-radar-bot-hover]")) keepTip();
              else if (next.botKey) leaveBotTip();
              else hideTip();
            },
          }
        : {},
    [isCompactViewport, showTip, hideTip, keepTip, leaveBotTip],
  );

  const menuItem = menu
    ? (items.find((item) => item.id === menu.itemId) ?? null)
    : null;
  // Neighbours within the same bucket (inline or More), so "Move up/down"
  // visibly swaps with what sits next to the item on screen.
  const menuSiblings = menuItem
    ? menuItem.isVisible
      ? inlineDestinations
      : overflow
    : [];
  const menuIndex = menuItem ? menuSiblings.indexOf(menuItem) : -1;
  const menuItems = useMemo<RadarMenuItem[]>(() => {
    if (!menuItem) return [];
    const list: RadarMenuItem[] = [];
    if (menuItem.action.kind === "open-plugin-panel") {
      list.push({
        kind: "item",
        id: "open-split",
        label: "Open in split",
        icon: "Columns2",
      });
      list.push({ kind: "separator" });
    }
    const isInline = menuItem.isVisible;
    list.push({
      kind: "item",
      id: "toggle",
      label: isInline ? "Move to More" : "Keep in sidebar",
      icon: isInline ? "PinOff" : "Pin",
      checked: isInline,
    });
    if (menuSiblings.length > 1) {
      list.push({ kind: "separator" });
      list.push({
        kind: "item",
        id: "move-up",
        label: "Move up",
        icon: "ArrowUp",
        disabled: menuIndex <= 0,
      });
      list.push({
        kind: "item",
        id: "move-down",
        label: "Move down",
        icon: "ArrowDown",
        disabled: menuIndex === -1 || menuIndex >= menuSiblings.length - 1,
      });
    }
    if (menuItem.pluginId) {
      list.push({ kind: "separator" });
      list.push({
        kind: "item",
        id: "details",
        label: "Plugin details",
        icon: "Puzzle",
      });
    }
    return list;
  }, [menuItem, menuSiblings, menuIndex]);

  // Swap the item with its on-screen neighbour inside BB's full order.
  const moveMenuItem = (direction: -1 | 1) => {
    const neighbour = menuSiblings[menuIndex + direction];
    if (!menuItem || !neighbour) return;
    const order = items.map((item) => item.id);
    const from = order.indexOf(menuItem.id);
    const to = order.indexOf(neighbour.id);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, menuItem.id);
    actions.setOrder(order);
  };

  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    hideTip();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 248;
    const x =
      rect.right + 8 + width <= window.innerWidth
        ? rect.right + 8
        : Math.max(8, rect.left - width - 8);
    setMoreAt({ x, y: rect.top });
  };

  // Show labels and Customize are rare, so they live in More, not on the rail.
  const moreActions: MoreAction[] = [
    ...(wideAllowed && hostSupportsWide
      ? [{
          key: "wide",
          label: wide ? "Hide labels" : "Show labels",
          icon: <HugeiconsIcon icon={wide ? ArrowLeftDoubleIcon : ArrowRightDoubleIcon} />,
          onSelect: () => {
            setMoreAt(null);
            toggleWide();
          },
        }]
      : []),
    {
      key: "customize",
      label: "Customize sidebar",
      icon: <HostIcon name="SlidersHorizontal" />,
      onSelect: () => {
        setMoreAt(null);
        actions.openCustomize();
      },
    },
  ];

  const renderMoreRow = () => {
    return (
      <button
        key="__more"
        ref={moreTriggerRef}
        type="button"
        aria-label={
          overflow.length > 0
            ? `More navigation, ${overflow.length} items`
            : "More navigation"
        }
        aria-expanded={moreAt !== null}
        title={!isCompactViewport ? undefined : "More"}
        onClick={(event) =>
          moreAt !== null ? setMoreAt(null) : openMore(event)
        }
        className={cn(
          "radar-nav-icon-button",
          (moreAt !== null || overflowActive) && "radar-nav-row-active",
        )}
        {...tipProps({
          key: "__more",
          label: "More",
          shortcut: null,
          hint: overflow.length > 0
            ? `${overflow.length} hidden ${overflow.length === 1 ? "destination" : "destinations"}, labels and Customize`
            : "Labels and Customize",
          Accessory: null,
        })}
      >
        <HostIcon name="MoreHorizontal" aria-hidden="true" />
        <span className="radar-rail-label">More</span>
        {overflow.length > 0 ? (
          <span className="radar-nav-count" aria-hidden="true">
            {overflow.length}
          </span>
        ) : null}
      </button>
    );
  };

  const renderTip = () => {
    if (isCompactViewport || !tip || moreAt || menu) return null;
    if (!tip.botKey) return <RailTooltip tip={tip} />;
    const bot = bots.find(bot => bot.key === tip.botKey);
    if (!bot) return null;
    const pulse = pulses.get(bot.current) ?? null;
    return createPortal(<RadarBotHoverCard bot={bot} tip={tip} pulse={pulse}
      coordinator={threads.find(thread => thread.id === bot.current)} workers={botWorkers(threads, bot)}
      state={botRailState(threads, bot, pulse)} onKeepOpen={keepTip} onLeave={leaveBotTip}
      onClose={closeBotTip} onNavigate={() => { hideTip(); notifyRailThreadNavigation(); }}
      onViewWorkers={() => { hideTip(); setRailScope(bot.key); }} />, document.body);
  };

  const renderOverlays = () => (
    <>
      {moreAt !== null ? (
        <MorePopover
          x={moreAt.x}
          y={moreAt.y}
          items={overflow}
          activeItemId={activeItemId}
          onActivate={activate}
          onOpenMenu={openMenu}
          onClose={closeMore}
          triggerRef={moreTriggerRef}
          actions={moreActions}
        />
      ) : null}
      {menu && menuItem ? (
        <RadarMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={(id) => {
            const target = menuItem;
            setMenu(null);
            if (id === "open-split") {
              activate(target, true);
            } else if (id === "toggle") {
              actions.setVisible(target.id, !target.isVisible);
            } else if (id === "move-up") {
              moveMenuItem(-1);
            } else if (id === "move-down") {
              moveMenuItem(1);
            } else if (id === "details") {
              actions.openDetails(target.id);
            }
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {renderTip()}
    </>
  );

  const destinationButtons = useMemo(
    () =>
      inlineDestinations.map((item) => {
        const hasMenu = item.action.kind !== "search-threads";
        return (
          <NavigationButton
            key={item.id}
            item={item}
            isActive={item.id === activeItemId}
            onActivate={activate}
            title={!isCompactViewport ? null : hintFor(item)}
            className={cn(
              "radar-nav-icon-button",
              item.id === activeItemId && "radar-nav-row-active",
            )}
            onContextMenu={
              hasMenu
                ? (event) => {
                    event.preventDefault();
                    openMenu(event.clientX, event.clientY, item);
                  }
                : undefined
            }
            {...tipProps({
              key: item.id,
              label: item.label,
              shortcut: item.shortcut?.label ?? null,
              hint: hasMenu ? "Right-click to arrange" : null,
              Accessory: item.experimental_Accessory,
            })}
          >
            <RowIcon item={item} />
            <span className="radar-rail-label">{item.label}</span>
            {item.experimental_Accessory ? (
              <span className="radar-rail-dot" aria-hidden="true" />
            ) : null}
            {isShortcutModifierHeld && item.shortcut ? (
              <kbd className="radar-double-shortcut">
                {item.shortcut.label}
              </kbd>
            ) : null}
          </NavigationButton>
        );
      }),
    [
      inlineDestinations,
      activeItemId,
      isCompactViewport,
      isShortcutModifierHeld,
      activate,
      openMenu,
      tipProps,
    ],
  );

  const botTiles = botRail && bots.length > 0 ? (
    <div role="group" aria-label="Bots" className="radar-rail-bots">
      <span className="radar-rail-divider" aria-hidden="true" />
      <button type="button" aria-pressed={crew}
        aria-label={crew ? "Crew: show all threads" : "Crew: every bot at a glance"}
        title={isCompactViewport ? "Crew" : undefined}
        className={cn("radar-nav-icon-button radar-rail-crew", crew && "radar-nav-row-active")}
        onClick={() => { hideTip(); setRailScope(crew ? null : CREW_SCOPE); }}
        {...tipProps({ key: "__crew", label: "Crew", shortcut: null, hint: "Every bot at a glance", Accessory: null })}>
        <HugeiconsIcon icon={UserGroupIcon} aria-hidden="true" />
        <span className="radar-rail-label">Crew</span>
      </button>
      {bots.map(bot => {
        const selected = bot.key === scope;
        // From the coordinator itself, a second tap goes back to every thread.
        const releases = selected && openThreadId === bot.current;
        const style = botStyle(bot.key, bot.name);
        const state = botRailState(threads, bot, pulses.get(bot.current) ?? null);
        const label = STATE_LABELS[state];
        const workers = botWorkers(threads, bot);
        const context = pulses.get(bot.current)?.context ?? null;
        const details = `${label.text} · ${workers.length} worker${workers.length === 1 ? "" : "s"} · ${context === null ? "Context unavailable" : `${Math.round(context * 100)}% context used`}`;
        return (
          <button key={bot.key} type="button" aria-pressed={selected}
            aria-haspopup={isCompactViewport ? undefined : "dialog"}
            aria-expanded={isCompactViewport ? undefined : tip?.botKey === bot.key}
            aria-controls={tip?.botKey === bot.key ? "radar-bot-hover-card" : undefined}
            aria-label={`${bot.name}, ${label.text}: ${releases ? "show all threads" : "open coordinator and its workers"}; ${details}`}
            title={isCompactViewport ? `${bot.name}: ${details}` : undefined}
            className={cn("radar-nav-icon-button radar-rail-bot", selected && "radar-rail-bot-active")}
            style={{ "--bot-hue": style.hue } as React.CSSProperties}
            onClick={() => {
              hideTip();
              if (releases) { setRailScope(null); return; }
              setRailScope(bot.key);
              navigate.toThread(bot.current);
              notifyRailThreadNavigation();
            }}
            {...tipProps({ key: `bot:${bot.key}`, botKey: bot.key, label: bot.name, shortcut: null,
              hint: null, Accessory: null })}>
            <BotAvatar emoji={style.emoji} context={context} />
            {workers.length > 0 ? <span className={cn("radar-rail-worker-count", label.tone)} aria-hidden="true">{workers.length > 99 ? "99+" : workers.length}</span> : null}
            <span className="radar-rail-label">{shortBotName(bot.name)}</span>
            {state !== "idle" ? <span className={cn("radar-rail-bot-dot", label.tone)} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "radar-double-navigation",
        wide && "radar-double-navigation-wide",
        botRail && "radar-double-navigation-bots",
        isCompactViewport && "radar-double-navigation-compact",
      )}
    >
      <nav
        ref={railRef}
        aria-label="Primary"
        className={cn("radar-nav radar-nav-compact", "radar-double-rail")}
        style={{ bottom: footerHeight }}
        onKeyDown={event => {
          if (event.key === "Escape") { hideTip(); return; }
          if (event.key === "Tab" && !event.shiftKey && tip?.botKey && event.target === tipTrigger.current) {
            const first = document.querySelector<HTMLAnchorElement>("[data-radar-bot-hover] a");
            if (first) { event.preventDefault(); first.focus(); keepTip(); return; }
          }
          moveRailFocus(event);
        }}
      >
        <div className={"radar-double-rail-items"}>
          <button
            type="button"
            aria-label="Home"
            aria-pressed={scope === null}
            title={isCompactViewport ? "Show all threads" : undefined}
            className="radar-nav-icon-button radar-nav-icon-primary"
            onClick={() => {
              hideTip();
              setMoreAt(null);
              setMenu(null);
              setRailScope(null);
            }}
            {...tipProps({
              key: "__home",
              label: "Home",
              shortcut: null,
              hint: "Show all threads",
              Accessory: null,
            })}
          >
            <HugeiconsIcon icon={Home01Icon} aria-hidden="true" />
            <span className="radar-rail-label">Home</span>
          </button>
          {destinationButtons}
          {renderMoreRow()}
          {botTiles}
        </div>
        <div className="radar-double-rail-footer">
          <span className="radar-rail-divider" aria-hidden="true" />
        </div>
      </nav>
      {renderOverlays()}
      <style>{hostCss}</style>
      <style ref={hostValuesRef} />
    </div>
  );
}

export function RadarRailNavigation(props: ExperimentalSidebarNavigationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const [bodyVisible, setBodyVisible] = useState(true);

  // BB retains the app sidebar beneath a hidden body while Settings is
  // shown. Unmount the rail in that body so its :has() styles and layout
  // effects release the gutter, labelled width and footer reservations.
  // Observe the sidebar's direct child, not the provider's own wrapper:
  // Customize hides that inner wrapper while intentionally keeping the rail.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const sidebar = root?.closest('[data-sidebar="sidebar"]');
    if (!root || !sidebar) return;
    let body: HTMLElement = root;
    while (body.parentElement && body.parentElement !== sidebar) {
      body = body.parentElement;
    }
    const sync = () => setBodyVisible(!body.hidden);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ["hidden"] });
    return () => observer.disconnect();
  }, []);

  // BB still owns and renders the footer. On desktop it stacks into the
  // rail's column, so reserve its measured height and keep navigation and
  // Customize above it. In the mobile drawer the footer stays a row beside
  // the rail, which runs the full height instead.
  useLayoutEffect(() => {
    if (props.isCompactViewport) {
      setFooterHeight(0);
      return;
    }
    const sidebar = rootRef.current?.closest('[data-sidebar="sidebar"]');
    const footer = sidebar?.querySelector<HTMLElement>(
      ':scope > [data-sidebar="footer"]',
    );
    if (!footer) return;
    const measure = () => setFooterHeight(footer.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [props.isCompactViewport]);

  return (
    <div ref={rootRef}>
      {bodyVisible ? (
        <RailNavigationBody {...props} footerHeight={footerHeight} />
      ) : null}
    </div>
  );
}
