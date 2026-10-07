import { createElement } from "react";
import { isBuiltinIconName } from "@/components/ui/icon";
import { needsChanged } from "@/lib/needsClient";
import { STATE_LABELS } from "./bots";
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import { railHostCss } from "./railHostStyles";
import type { ExperimentalSidebarNavigationItem, ExperimentalSidebarNavigationProps, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { makeProject, makeThread, NOW } from "./fixtures";
import { resetRailScope, setRailScope, useRailScope, useRailThreadNavigation } from "./railScope";
import { useRailNewThread } from "./railNewThread";

const host = vi.hoisted(() => ({
  railNav: true,
  botRail: null as boolean | null,
  items: null as ExperimentalSidebarNavigationItem[] | null,
  sidebarThreads: null as Partial<PluginSidebarThreadsState> | null,
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    useSettings: () => { const state = actual.useSettings(); return { ...state, values: { ...state.values, railNav: host.railNav, ...(host.botRail === null ? {} : { botRail: host.botRail }) } }; },
    experimental_useSidebarThreads: (...args: Parameters<typeof actual.experimental_useSidebarThreads>) => ({
      ...actual.experimental_useSidebarThreads(...args),
      ...host.sidebarThreads,
    }),
    experimental_useSidebarNavigation: () => {
      const state = actual.experimental_useSidebarNavigation();
      return host.items ? { ...state, items: host.items } : state;
    },
  };
});

const app = await loadPluginApp(() => import("../../app"));
const navigation = app.experimentalSidebarNavigations[0]!;
const props = { isCompactViewport: false, experimental_Original: () => null };
function destination(id: string, label: string, isVisible = true): ExperimentalSidebarNavigationItem {
  return {
    id: `alpha/${id}`, label, action: { kind: "open-plugin-panel", pluginId: "alpha", panelId: id },
    icon: { kind: "plugin", pluginId: "alpha", icon: "Zap" }, isDisabled: false,
    isVisible, isLoading: false, pluginId: "alpha", shortcut: null, experimental_Accessory: null,
  };
}
/** The rail's host <style> elements still in the document (the harness adds its own). */
function railHostStyles(): HTMLStyleElement[] {
  return Array.from(document.querySelectorAll("style")).filter((style) => style.textContent?.includes('[data-sidebar="sidebar"]'));
}
/** Show labels and Customize sit in the rail's More popover. */
function openMore() {
  fireEvent.click(screen.getByRole("button", { name: /^More navigation/ }));
}
function mount(items: ExperimentalSidebarNavigationItem[], isCompactViewport = false) {
  return renderSlot(navigation, { ...props, isCompactViewport }, { sidebarNavigation: { items } });
}
afterEach(() => { cleanup(); host.items = null; host.railNav = true; host.botRail = null; host.sidebarThreads = null; resetRailScope(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("host navigation arrangement", () => {
  it.each([false, true])("renders host order and visibility immediately (compact=%s)", (compact) => {
    const slot = mount([destination("notes", "Notes"), destination("hidden", "Hidden", false), destination("board", "Board")], compact);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Home", "Notes", "Board", "More navigation, 1 items"]);
    expect(screen.queryByRole("button", { name: "Hidden" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    expect(screen.getByRole("button", { name: "Hidden" })).toBeTruthy();
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("applies host visibility and order updates without a preference fetch or window focus", () => {
    const board = destination("board", "Board");
    const notes = destination("notes", "Notes");
    const slot = mount([board, notes]);
    host.items = [notes, { ...board, isVisible: false }];
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.getByRole("button", { name: "More navigation, 1 items" })).toBeTruthy();
    host.items = [notes, board];
    slot.rerender(createElement(navigation.component, props));
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Home", "Notes", "Board", "More navigation"]);
    fireEvent.focus(window);
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("delegates Move to More and Keep in sidebar to host actions without rewriting order", () => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to More" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "setVisible", itemId: board.id, isVisible: false }]);
    // The host publishes the save result. Radar keeps no competing snapshot.
    host.items = [{ ...board, isVisible: false }];
    slot.rerender(createElement(navigation.component, props));
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep in sidebar" }));
    expect(slot.inspection.sidebarNavigationCalls).toContainEqual({ method: "setVisible", itemId: board.id, isVisible: true });
    expect(slot.inspection.sdkCalls).toEqual([]);
  });

  it("preserves split activation from inline and overflow destinations", () => {
    const board = destination("board", "Board");
    const notes = destination("notes", "Notes", false);
    const slot = mount([board, notes]);
    fireEvent.click(screen.getByRole("button", { name: "Board" }), { altKey: true });
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: board.id, openInSplit: true },
      { method: "activate", itemId: notes.id, openInSplit: true },
    ]);
  });

  it("keeps search available and delegates the rail customize button to BB", () => {
    const search: ExperimentalSidebarNavigationItem = {
      ...destination("search", "Search threads"),
      id: "__bb__/search-threads",
      action: { kind: "search-threads" },
      pluginId: null,
    };
    const slot = mount([search]);
    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    openMore();
    fireEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: search.id, openInSplit: false },
      { method: "openCustomize" },
    ]);
    // Settings comes from BB's existing footer, which this slot doesn't own.
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("keeps the rail on compact viewports, marked compact, without tooltips", () => {
    const slot = mount([destination("board", "Board")]);
    expect(document.querySelector(".radar-double-navigation-compact")).toBeNull();
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    expect(document.querySelector(".radar-double-navigation.radar-double-navigation-compact")).toBeTruthy();
    expect(document.querySelector(".radar-double-rail")).toBeTruthy();
    const board = screen.getByRole("button", { name: "Board" });
    fireEvent.focus(board);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(board.getAttribute("title")).toBe("Board");
    openMore();
    expect(screen.getByRole("button", { name: "Customize sidebar" })).toBeTruthy();
  });

  it("reserves changing host footer height and releases its observer on mobile", () => {
    let footerHeight = 180;
    // Two observers exist: the footer-height one under test and the rail's
    // own reserve/overflow one. Fan callbacks out to all of them.
    const callbacks: Array<() => void> = [];
    const resize = () => callbacks.forEach((callback) => callback());
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-sidebar") === "footer" ? footerHeight : 0;
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe = observe;
      disconnect = disconnect;
    });
    const wrapped = {
      ...navigation,
      component: (p: ExperimentalSidebarNavigationProps) => createElement(
        "div", { "data-sidebar": "sidebar" },
        createElement(navigation.component, p),
        createElement("div", { "data-sidebar": "footer" }),
      ),
    };
    const slot = renderSlot(wrapped, props, { sidebarNavigation: { items: [destination("board", "Board")] } });
    expect(observe).toHaveBeenCalledWith(document.querySelector('[data-sidebar="footer"]'));
    expect((document.querySelector(".radar-double-rail") as HTMLElement).style.bottom).toBe("180px");
    footerHeight = 280;
    act(() => resize());
    expect((document.querySelector(".radar-double-rail") as HTMLElement).style.bottom).toBe("280px");
    slot.rerender(createElement(wrapped.component, { ...props, isCompactViewport: true }));
    // The footer observer is released; the rail stays, running full height.
    expect(disconnect).toHaveBeenCalled();
    expect((document.querySelector(".radar-double-rail") as HTMLElement).style.bottom).toBe("0px");
    slot.lifecycle.unmount();
  });

  it("tracks scroll position in both stacks and releases cues and listeners on unmount", () => {
    let overflowing = true;
    const callbacks: Array<() => void> = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    const isStack = (element: HTMLElement) => element.classList.contains("radar-double-rail-items")
      || element.getAttribute("data-sidebar") === "menu";
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return isStack(this) ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return isStack(this) ? (overflowing ? 200 : 100) : 0;
    });
    const wrapped = {
      ...navigation,
      component: (p: ExperimentalSidebarNavigationProps) => createElement(
        "div", { "data-sidebar": "sidebar" },
        createElement(navigation.component, p),
        createElement("div", { "data-sidebar": "footer" },
          createElement("div", { "data-sidebar": "menu" })),
      ),
    };
    const slot = renderSlot(wrapped, props, { sidebarNavigation: { items: [destination("board", "Board")] } });
    const nav = document.querySelector(".radar-double-navigation")!;
    const sidebar = document.querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
    const rail = document.querySelector<HTMLElement>(".radar-double-rail")!;
    const footer = document.querySelector<HTMLElement>('[data-sidebar="footer"]')!;
    const stacks = [document.querySelector<HTMLElement>(".radar-double-rail-items")!,
      document.querySelector<HTMLElement>('[data-sidebar="menu"]')!];
    // BB's footer thumb and the height reserve are rules in the rail's own
    // <style>; BB's elements are never written to.
    const hostValues = nav.querySelectorAll<HTMLStyleElement>(":scope > style")[1]!;
    const value = (name: string) => hostValues.textContent?.match(new RegExp(`${name}: ([^;]+);`))?.[1] ?? "";
    const thumbs = (name: string) => [rail.style.getPropertyValue(name), value(name)];
    expect(nav.hasAttribute("data-rail-overflow")).toBe(true);
    expect(value("--radar-rail-reserve")).not.toBe("");
    expect(thumbs("--radar-scroll-height")).toEqual(["50px", "50px"]);
    expect(thumbs("--radar-scroll-top")).toEqual(["0px", "0px"]);
    for (const element of [document.documentElement, sidebar, footer]) expect(element.getAttribute("style")).toBeNull();
    // A burst of scroll events waits for one frame instead of reading
    // layout per event.
    stacks.forEach((stack) => { stack.scrollTop = 100; fireEvent.scroll(stack); fireEvent.scroll(stack); });
    expect(thumbs("--radar-scroll-top")).toEqual(["0px", "0px"]);
    expect(frames).toHaveLength(1);
    frames.splice(0).forEach((frame) => frame(0));
    expect(thumbs("--radar-scroll-top")).toEqual(["50px", "50px"]);
    overflowing = false;
    act(() => callbacks.forEach((callback) => callback()));
    expect(nav.hasAttribute("data-rail-overflow")).toBe(false);
    expect(thumbs("--radar-scroll-height")).toEqual(["", ""]);
    expect(hostValues.textContent).not.toContain("::after");
    overflowing = true;
    act(() => callbacks.forEach((callback) => callback()));
    slot.lifecycle.unmount();
    stacks.forEach((stack) => fireEvent.scroll(stack));
    expect(frames).toHaveLength(0);
    expect(railHostStyles()).toEqual([]);
    for (const element of [document.documentElement, sidebar, footer]) expect(element.getAttribute("style")).toBeNull();
  });

  it.each([false, true])("releases the rail when BB hides the app body for Settings and restores it on return (compact=%s)", async (compact) => {
    const wrapped = {
      ...navigation,
      component: (p: ExperimentalSidebarNavigationProps) => createElement(
        "div", { "data-sidebar": "sidebar" },
        createElement("div", { "data-testid": "app-sidebar-body" },
          createElement(navigation.component, p)),
        createElement("div", { "data-sidebar": "footer" }),
      ),
    };
    const slot = renderSlot(wrapped, { ...props, isCompactViewport: compact }, {
      sidebarNavigation: { items: [destination("board", "Board")] },
    });
    const body = document.querySelector<HTMLElement>('[data-testid="app-sidebar-body"]')!;
    expect(document.querySelector(".radar-double-navigation")).toBeTruthy();
    body.hidden = true;
    await waitFor(() => expect(document.querySelector(".radar-double-navigation")).toBeNull());
    // The rail's host styles go with it.
    expect(document.querySelector('[data-sidebar="sidebar"] style')).toBeNull();
    body.hidden = false;
    await waitFor(() => expect(screen.getByRole("button", { name: "Board" })).toBeTruthy());
    // The host's inner Customize wrapper is a separate visibility boundary.
    const root = body.firstElementChild as HTMLElement;
    root.hidden = true;
    await Promise.resolve();
    expect(document.querySelector(".radar-double-navigation")).toBeTruthy();
    root.hidden = false;
    slot.lifecycle.unmount();
    body.hidden = true;
    await Promise.resolve();
    expect(document.documentElement.style.getPropertyValue("--radar-rail-reserve")).toBe("");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("supports host split modifiers %s", (modifiers) => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.click(screen.getByRole("button", { name: "Board" }), modifiers);
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "activate", itemId: board.id, openInSplit: true },
    ]);
  });
});

describe("rail ergonomics", () => {
  it("steps focus through the rail with arrow keys and wraps at the ends", () => {
    mount([destination("notes", "Notes"), destination("board", "Board")]);
    const notes = screen.getByRole("button", { name: "Notes" });
    const board = screen.getByRole("button", { name: "Board" });
    const more = screen.getByRole("button", { name: "More navigation" });
    notes.focus();
    fireEvent.keyDown(notes, { key: "ArrowDown" });
    expect(document.activeElement).toBe(board);
    fireEvent.keyDown(board, { key: "End" });
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Home" }), { key: "ArrowUp" });
    expect(document.activeElement).toBe(more);
  });

  it("shows a tooltip with the label, shortcut and accessory on focus", () => {
    const Accessory = () => createElement("span", null, "3 new");
    const notes = { ...destination("notes", "Notes"), shortcut: { label: "⌘1", ariaKeyShortcuts: "Meta+1" }, experimental_Accessory: Accessory };
    mount([notes]);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: "Notes (⌘1)" }));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Notes");
    expect(tip.textContent).toContain("⌘1");
    expect(tip.textContent).toContain("3 new");
    fireEvent.blur(screen.getByRole("button", { name: "Notes (⌘1)" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not draw tooltips on compact viewports", () => {
    mount([destination("notes", "Notes")], true);
    fireEvent.focus(screen.getByRole("button", { name: "Notes" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("title")).toBe("Notes");
  });

  it.each([false, true])("focuses the first enabled More item for immediate keyboard traversal (rail=%s)", (rail) => {
    host.railNav = rail;
    mount([
      { ...destination("disabled", "Disabled", false), isDisabled: true },
      destination("notes", "Notes", false),
      { ...destination("loading", "Loading", false), isLoading: true },
      destination("board", "Board", false),
    ]);
    const more = screen.getByRole("button", { name: "More navigation, 4 items" });
    act(() => more.focus());
    fireEvent.click(more);
    const notes = screen.getByRole("button", { name: "Notes" });
    const board = screen.getByRole("button", { name: "Board" });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "ArrowDown" });
    expect(document.activeElement).toBe(board);
    fireEvent.keyDown(board, { key: "Home" });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "ArrowUp" });
    // The rail's More ends with its own actions; the stock one ends at Board.
    const last = rail ? screen.getByRole("button", { name: "Customize sidebar" }) : board;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("clears an open desktop tooltip when entering compact mode without restoring it later", () => {
    const slot = mount([destination("notes", "Notes")]);
    fireEvent.focus(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels pending desktop tooltips when entering compact mode", () => {
    vi.useFakeTimers();
    const slot = mount([destination("notes", "Notes")]);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Notes" }));
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: true }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reorders within the visible bucket through host setOrder", () => {
    const notes = destination("notes", "Notes");
    const hidden = destination("hidden", "Hidden", false);
    const board = destination("board", "Board");
    const slot = mount([notes, hidden, board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    expect((screen.getByRole("menuitem", { name: "Move down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([
      { method: "setOrder", itemIds: [board.id, notes.id, hidden.id] },
    ]);
  });

  it("opens plugin details from the context menu", () => {
    const board = destination("board", "Board");
    const slot = mount([board]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Plugin details" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "openDetails", itemId: board.id }]);
  });
});

describe("unscoped heading", () => {
  const newThread: ExperimentalSidebarNavigationItem = { ...destination("new", "New thread"), id: "__bb__/new-thread", action: { kind: "new-thread" }, pluginId: null, shortcut: { label: "⌘N", ariaKeyShortcuts: "Meta+N" } };

  it.each([false, true])("drops the heading and hands New thread to the list (compact=%s)", (compact) => {
    const slot = mount([newThread, destination("notes", "Notes")], compact);
    expect(slot.container.querySelector(".radar-double-heading")).toBeNull();
    expect(screen.queryByRole("button", { name: /^New thread/ })).toBeNull();
    const handoff = renderHook(() => useRailNewThread());
    expect(handoff.result.current).toMatchObject({ label: "New thread (⌘N)", keyShortcuts: "Meta+N" });
    act(() => handoff.result.current!.open(false));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: newThread.id, openInSplit: false }]);
    slot.lifecycle.unmount();
    expect(handoff.result.current).toBeNull();
  });
});

describe("wide rail", () => {
  function newThread(): ExperimentalSidebarNavigationItem {
    return { ...destination("new", "New thread"), id: "__bb__/new-thread", action: { kind: "new-thread" }, pluginId: null };
  }

  // Wide mode needs the setting on and BB's sidebar structure around the slot.
  function hostShell(p: ExperimentalSidebarNavigationProps) {
    return createElement(
      "div", { className: "group peer" },
      createElement(
        "div", { style: { "--sidebar-width": "320px" } as React.CSSProperties },
        createElement("div", { "data-sidebar": "sidebar" }, createElement(navigation.component, p), createElement("div", { "data-sidebar": "footer" })),
      ),
    );
  }
  function mountWide(items: ExperimentalSidebarNavigationItem[], settings: Record<string, boolean> = { wideRail: true }) {
    return renderSlot({ ...navigation, component: hostShell }, props, { sidebarNavigation: { items }, settings });
  }

  it("hides the toggle unless the setting is on and the host shell is recognised", () => {
    mount([newThread()]);
    openMore();
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
    cleanup();
    mountWide([newThread()], { wideRail: false });
    openMore();
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
    cleanup();
    renderSlot(navigation, props, { sidebarNavigation: { items: [newThread()] }, settings: { wideRail: true } });
    openMore();
    expect(screen.queryByRole("button", { name: "Show labels" })).toBeNull();
  });

  it("toggles wide mode, labels the rail and remembers the choice", () => {
    mountWide([newThread(), destination("board", "Board")]);
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
    openMore();
    fireEvent.click(screen.getByRole("button", { name: "Show labels" }));
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(document.querySelector(".radar-double-navigation-wide")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Board" }).querySelector(".radar-rail-label")?.textContent).toBe("Board");
    expect(localStorage.getItem("radar-sidebar:rail-wide:v1")).toBe("1");
    cleanup();
    mountWide([newThread()]);
    expect(document.querySelector(".radar-double-navigation-wide")).toBeTruthy();
    openMore();
    fireEvent.click(screen.getByRole("button", { name: "Hide labels" }));
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
  });
});

describe("bot rail experiment", () => {
  const projects = [makeProject({ id: "proj_a", name: "Alpha" }), makeProject({ id: "proj_b", name: "Beta" })];
  const threads = [makeThread({ id: "coordinator", projectId: "proj_a" })];
  const bot = { key: "personal", name: "Personal Bot", current: "coordinator", projectId: "proj_a", projects: [], hostId: "host_1", providerId: "pi", model: "test", rollover: null };
  function mountBots(enabled: boolean, compact = false) {
    return renderSlot(navigation, { ...props, isCompactViewport: compact }, {
      settings: { botRail: enabled }, sidebarNavigation: { items: [destination("board", "Board")] },
      sidebarThreads: { threads, projects },
      sdk: { providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) }, plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: { output: async () => ({ output: "Nothing to do." }), context: async () => ({ usage: null }) } },
    });
  }
  it.each([false, true])("removes project tiles with the experiment off (compact=%s)", compact => {
    setRailScope("proj_a"); // A stale scope must not hide all threads.
    mountBots(false, compact);
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Bots" })).toBeNull();
    // The unscoped heading gives its row back to the list.
    expect(document.querySelector(".radar-double-heading")).toBeNull();
  });
  it.each([false, true])("scopes by bot identity without a heading of its own and clears via Home (compact=%s)", async compact => {
    mountBots(true, compact);
    const tile = await screen.findByRole("button", { name: /Personal Bot, Idle:/ });
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
    fireEvent.click(tile);
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("personal");
    // The list shows the scope as a pill; the rail adds no heading row.
    expect(document.querySelector(".radar-double-heading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(tile.getAttribute("aria-pressed")).toBe("false");
  });
  it("places state faces below destinations and keeps workers and context in details", async () => {
    const worker = makeThread({ id: "worker", parentThreadId: "coordinator", status: "active" });
    const slot = renderSlot(navigation, props, {
      settings: { botRail: true }, sidebarNavigation: { items: [destination("board", "Board")] },
      sidebarThreads: { threads: [...threads, worker], projects },
      sdk: { providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) }, plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: {
        output: async () => { throw new Error("No output"); }, context: async () => ({ usage: { estimated: false, usedTokens: 650, modelContextWindow: 1000 } }),
      } },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot, Working:/ });
    await waitFor(() => expect(tile.getAttribute("aria-label")).toContain("65% context used"));
    expect(tile.getAttribute("aria-label")).toContain("1 worker");
    expect(tile.querySelector(".radar-rail-worker-count")).toBeNull();
    expect(tile.querySelector(".radar-bot-ring")).toBeNull();
    expect(tile.querySelector(".radar-bot-state-ring-working")).toBeTruthy();
    expect(tile.querySelector(".radar-rail-bot-state-label")?.textContent).toContain("1 worker");
    const controls = Array.from(slot.container.querySelectorAll(".radar-double-rail-items button"));
    expect(controls.indexOf(screen.getByRole("button", { name: "Board" }))).toBeLessThan(controls.indexOf(tile));
  });
  it.each([false, true])("keeps family unread cues alongside working status until the host marks every reply read (compact=%s)", async compact => {
    const coordinator = makeThread({ id: "coordinator", isUnread: true });
    const worker = makeThread({ id: "worker", parentThreadId: "coordinator", status: "active", isUnread: true });
    const slot = renderSlot(navigation, { ...props, isCompactViewport: compact }, {
      settings: { botRail: true }, sidebarThreads: { threads: [coordinator, worker], projects }, sdk: {
        providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) },
        plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T },
        threads: { output: async () => ({ output: "The revised plan is ready." }), context: async () => ({ usage: null }) },
      },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot, Working:/ });
    expect(tile.classList.contains("radar-rail-bot-unread")).toBe(true);
    expect(tile.querySelector(".radar-rail-bot-unread-badge")).toBeTruthy();
    expect(tile.querySelector(".radar-bot-state-ring-working")).toBeTruthy();
    expect(tile.getAttribute("aria-label")).toContain("Unread reply");
    fireEvent.click(tile);
    // Navigation alone does not optimistically clear a notification: BB owns read state.
    expect(tile.querySelector(".radar-rail-bot-unread-badge")).toBeTruthy();
    host.sidebarThreads = { threads: [{ ...coordinator, isUnread: false }, worker], projects };
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: compact }));
    // The worker's reply still contributes to family unread.
    expect(tile.classList.contains("radar-rail-bot-unread")).toBe(true);
    expect(tile.querySelector(".radar-bot-unread-dot")).toBeTruthy();
    host.sidebarThreads = { threads: [{ ...coordinator, isUnread: false }, { ...worker, isUnread: false }], projects };
    slot.rerender(createElement(navigation.component, { ...props, isCompactViewport: compact }));
    expect(tile.classList.contains("radar-rail-bot-unread")).toBe(false);
    expect(tile.querySelector(".radar-rail-bot-unread-badge")).toBeNull();
    expect(tile.querySelector(".radar-bot-state-ring-working")).toBeTruthy();
    expect(tile.getAttribute("aria-label")).not.toContain("Unread reply");
  });
  it("keeps a judged plain-language decision visible after reading and opens its action", async () => {
    const coordinator = makeThread({ id: "coordinator", isUnread: false });
    renderSlot(navigation, props, { settings: { botRail: true }, sidebarThreads: { threads: [coordinator], projects },
      rpc: { crew_asks: () => ({ judgements: [{ threadId: coordinator.id, version: coordinator.latestAttentionAt, waiting: 0.99, ask: "Approve the repair?" }] }) },
      sdk: { providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) }, plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: { output: async () => ({ output: "Should I approve the repair?" }), context: async () => ({ usage: null }) } },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot, Decision:/ });
    expect(tile.querySelector(".radar-rail-bot-unread-badge")).toBeNull();
    fireEvent.focus(tile);
    const card = screen.getByRole("dialog", { name: "Personal Bot details" });
    expect(within(card).getByText("Approve the repair?")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Review decision" }).getAttribute("href")).toBe(coordinator.href);
  });
  it("uses the saved ask record in the hover card and clears Decision after Done", async () => {
    let dismissed = false;
    const coordinator = makeThread({ id: "coordinator" });
    const canonical = "Approve the full repair and the transport quote together?";
    renderSlot(navigation, props, {
      settings: { botRail: true }, sidebarThreads: { threads: [coordinator], projects },
      rpc: { crew_asks: () => ({ judgements: [{ threadId: coordinator.id, version: coordinator.latestAttentionAt, waiting: 0.99, ask: canonical, itemId: "saved-ask", dismissed }] }) },
      sdk: { plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: {
        output: async () => ({ output: "Repair is ready.\nDecision needed: approve repair?" }), context: async () => ({ usage: null }),
      } },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot, Decision:/ });
    await waitFor(() => expect(tile.querySelector(".radar-bot-attention-badge")?.textContent).toBe("?"));
    fireEvent.focus(tile);
    await screen.findByText(canonical);
    expect(within(screen.getByRole("dialog", { name: "Personal Bot details" })).queryByText("approve repair?")).toBeNull();
    dismissed = true;
    act(needsChanged);
    await screen.findByRole("button", { name: /Personal Bot, Idle:/ });
    expect(tile.querySelector(".radar-bot-attention-badge")).toBeNull();
    expect(screen.queryByText(canonical)).toBeNull();
  });

  it("honors the motion setting in both rail and portalled hover card", async () => {
    renderSlot(navigation, props, { settings: { botRail: true, motion: false }, sidebarThreads: { threads: [makeThread({ id: "coordinator", status: "active" })], projects },
      sdk: { plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: { context: async () => ({ usage: null }) } },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot, Working:/ });
    expect(tile.querySelector(".radar-bot-state-ring-working")).toBeTruthy();
    expect(tile.querySelector(".radar-bot-state-motion")).toBeNull();
    fireEvent.focus(tile);
    const card = screen.getByRole("dialog", { name: "Personal Bot details" });
    expect(card.querySelector(".radar-bot-state-ring-working")).toBeTruthy();
    expect(card.querySelector(".radar-bot-state-motion")).toBeNull();
  });

  it("keeps the unread badge when loud unread highlighting is disabled", async () => {
    renderSlot(navigation, props, {
      settings: { botRail: true, loudUnread: false }, sidebarThreads: { threads: [makeThread({ id: "coordinator", isUnread: true })], projects }, sdk: {
        providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) },
        plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T },
        threads: { output: async () => ({ output: "Nothing to do." }), context: async () => ({ usage: null }) },
      },
    });
    const tile = await screen.findByRole("button", { name: /Personal Bot,/ });
    expect(tile.classList.contains("radar-rail-bot-unread")).toBe(false);
    expect(tile.querySelector(".radar-rail-bot-unread-badge")).toBeTruthy();
  });
  it.each(([
    ["idle", {}, null, "Idle"], ["unread", { isUnread: true }, null, "New reply"],
    ["working", { status: "active" }, null, "Working"], ["queued", { queuedWork: "waiting" }, null, "Queued"],
    ["needs-you", { hasPendingInteraction: true }, null, "Needs you"], ["failed", { queuedWork: "failed" }, null, "Failed"],
    ["decision", {}, "Decision needed: approve the repair?", "Decision"], ["rollover", { status: "active" }, null, "Handover"],
    ["unavailable", null, null, "Unavailable"],
  ] as const).flatMap(row => [false, true].map(compact => [...row, compact] as const)))("renders and opens %s (%s, %s, %s, compact=%s)", async (state, extra, output, text, compact) => {
    const slot = renderSlot(navigation, { ...props, isCompactViewport: compact }, {
      settings: { botRail: true }, sidebarThreads: { threads: extra ? [makeThread({ id: "coordinator", ...extra })] : [], projects }, sdk: {
        providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) },
        plugins: { callRpc: async <T,>() => ({ bots: [{ ...bot, rollover: state === "rollover" ? "summary" : null }] }) as T },
        threads: { output: async () => ({ output }), context: async () => ({ usage: null }) },
      },
    });
    const tile = await screen.findByRole("button", { name: new RegExp(`Personal Bot, ${text}:`) });
    expect(tile.classList.contains(`radar-rail-bot-state-${state}`)).toBe(true);
    expect(tile.querySelector("[data-bot-state]")?.getAttribute("data-bot-state")).toBe(state);
    if (["working", "queued", "rollover", "unavailable"].includes(state)) expect(tile.querySelector(`.radar-bot-state-ring-${state} circle`)).toBeTruthy();
    if (["failed", "needs-you", "decision"].includes(state)) expect(tile.querySelector(".radar-bot-attention-badge")?.textContent).toBe(state === "failed" ? "!" : "?");
    if (state === "unread") expect(tile.querySelector(".radar-bot-unread-dot")).toBeTruthy();
    if (state === "idle") expect(tile.querySelector(".radar-bot-state-ring, .radar-bot-attention-badge, .radar-bot-unread-dot")).toBeNull();
    expect(isBuiltinIconName(STATE_LABELS[state].icon)).toBe(true);
    expect(tile.querySelector(".radar-rail-bot-state-label")?.textContent).toContain(text);
    if (!compact) {
      fireEvent.focus(tile);
      const card = screen.getByRole("dialog", { name: "Personal Bot details" });
      expect(within(card).getByTitle(STATE_LABELS[state].description)).toBeTruthy();
      const action = within(card).getByRole("link", { name: STATE_LABELS[state].action });
      expect(action.getAttribute("href")).toBe(extra ? makeThread({ id: "coordinator" }).href : `/projects/${bot.projectId}/threads/${bot.current}`);
    }
    if (process.env.RADAR_QA_DIR) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.RADAR_QA_DIR}/${state}${compact ? "-mobile" : ""}.html`, tile.outerHTML);
    }
    fireEvent.click(tile);
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: bot.current });
  });
  it("refreshes live context without reading streaming output or restarting on every token", async () => {
    vi.useFakeTimers();
    let usedTokens = 250;
    const output = vi.fn(async () => ({ output: "Nothing to do." }));
    const context = vi.fn(async () => ({ usage: { estimated: false, usedTokens, modelContextWindow: 1000 } }));
    const active = makeThread({ id: "coordinator", status: "active" });
    const slot = renderSlot(navigation, props, { settings: { botRail: true }, sidebarThreads: { threads: [active], projects }, sdk: {
      providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) }, plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: { output, context },
    } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("button", { name: /Personal Bot, Working:/ }).getAttribute("aria-label")).toContain("25% context used");
    host.sidebarThreads = { threads: [{ ...active, updatedAt: active.updatedAt + 1 }], projects };
    slot.rerender(createElement(navigation.component, props));
    usedTokens = 700;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("button", { name: /Personal Bot, Working:/ }).getAttribute("aria-label")).toContain("70% context used");
    expect(context).toHaveBeenCalledTimes(2);
    expect(output).not.toHaveBeenCalled();
  });
  it("shows live bot details, keeps the card open across the pointer gap, and scopes workers from it", async () => {
    vi.useFakeTimers();
    const coordinator = makeThread({ id: "coordinator", isUnread: true });
    const workers = [
      makeThread({ id: "busy", parentThreadId: "coordinator", title: "Check reminders", status: "active" }),
      makeThread({ id: "question", lifecycleOwnerThreadId: "coordinator", title: "Approve booking", hasPendingInteraction: true }),
      makeThread({ id: "failed", parentThreadId: "coordinator", title: "Sync failed", status: "error" }),
      makeThread({ id: "hidden", parentThreadId: "coordinator", title: "Hidden helper", isHidden: true }),
    ];
    const slot = renderSlot(navigation, props, { settings: { botRail: true }, sidebarThreads: { threads: [coordinator, ...workers], projects }, sdk: {
      providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) }, plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: {
        output: async () => ({ output: "Checked tomorrow's schedule.\nDecision needed: approve the booking?" }),
        context: async () => ({ usage: { estimated: true, usedTokens: 65000, modelContextWindow: 100000 } }),
      },
    } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const tile = screen.getByRole("button", { name: /Personal Bot, Failed:/ });
    fireEvent.pointerEnter(tile);
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    const card = screen.getByRole("dialog", { name: "Personal Bot details" });
    expect(within(card).getByText("Checked tomorrow's schedule.")).toBeTruthy();
    expect(within(card).getByText("Needs your decision")).toBeTruthy();
    expect(within(card).getByText("approve the booking?")).toBeTruthy();
    expect(within(card).getByText("1 working · 1 waiting on you · 1 failed")).toBeTruthy();
    expect(within(card).getByText("65K / 100K tokens · estimated")).toBeTruthy();
    expect(within(card).getByRole("meter").getAttribute("aria-valuenow")).toBe("65");
    expect(within(card).queryByText("Hidden helper")).toBeNull();
    expect(within(card).getAllByRole("link").map(link => link.textContent)).toEqual(["Sync failedFailed", "Approve bookingNeeds you", "Check remindersWorking", "Check failure", "Open coordinator"]);
    expect(within(card).getByRole("link", { name: "Check failure" }).getAttribute("href")).toBe(workers[2]!.href);
    if (process.env.RADAR_QA_DIR) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.RADAR_QA_DIR}/hover.html`, card.outerHTML);
    }
    fireEvent.pointerLeave(tile);
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    fireEvent.pointerEnter(card);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("dialog", { name: "Personal Bot details" })).toBeTruthy();
    host.sidebarThreads = { threads: [coordinator, workers[0]!], projects };
    slot.rerender(createElement(navigation.component, props));
    expect(within(card).queryByText("Sync failed")).toBeNull();
    expect(within(card).getByText("1 working")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "View workers" }));
    expect(screen.queryByRole("dialog", { name: "Personal Bot details" })).toBeNull();
    expect(tile.getAttribute("aria-pressed")).toBe("true");
  });
  it.each([
    [{ status: "active" }, "View live work"], [{ queuedWork: "waiting" }, "View queued work"],
    [{ hasPendingInteraction: true }, "Reply to question"], [{ status: "error", isUnread: false }, "Check failure"],
    [{ isUnread: true }, "Read reply"],
  ] as const)("routes the family action to the affected worker (%s)", async (extra, action) => {
    const coordinator = makeThread({ id: "coordinator" });
    const worker = makeThread({ id: "affected", parentThreadId: coordinator.id, ...extra });
    renderSlot(navigation, props, { settings: { botRail: true }, sidebarThreads: { threads: [coordinator, worker], projects }, sdk: {
      providers: { models: async () => ({ models: [], selectedOnlyModels: [], providers: [], permissionCeiling: "auto", modelLoadError: null }) },
      plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T }, threads: { output: async () => ({ output: "No action needed." }), context: async () => ({ usage: null }) },
    } });
    const tile = await screen.findByRole("button", { name: /Personal Bot,/ });
    fireEvent.focus(tile);
    const card = screen.getByRole("dialog", { name: "Personal Bot details" });
    expect(within(card).getByRole("link", { name: action }).getAttribute("href")).toBe(worker.href);
  });
  it("makes the hover actions reachable by keyboard and returns focus on Escape", async () => {
    mountBots(true);
    const tile = await screen.findByRole("button", { name: /Personal Bot, Idle:/ });
    act(() => tile.focus());
    const card = screen.getByRole("dialog", { name: "Personal Bot details" });
    expect(within(card).getByText("No usage data available for this session.")).toBeTruthy();
    fireEvent.keyDown(tile, { key: "Tab" });
    expect(document.activeElement).toBe(within(card).getByRole("link", { name: "Open coordinator" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(tile);
    expect(screen.queryByRole("dialog", { name: "Personal Bot details" })).toBeNull();
  });
  it("opens the coordinator from its face, closing the drawer through the list's callback", async () => {
    const onNavigate = vi.fn();
    function Dismissal() { useRailThreadNavigation(onNavigate); return null; }
    const wrapped = { ...navigation, component: (p: ExperimentalSidebarNavigationProps) => createElement("div", null, createElement(navigation.component, p), createElement(Dismissal)) };
    const slot = renderSlot(wrapped, props, { settings: { botRail: true }, sidebarThreads: { threads, projects }, sdk: { plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T } } });
    fireEvent.click(await screen.findByRole("button", { name: /Personal Bot, Idle: open coordinator and its workers/ }));
    expect(slot.navigateCalls).toEqual([{ method: "toThread", threadId: "coordinator" }]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("personal");
  });
  it("goes back to every thread on a second tap from the coordinator, and back to it from a worker", async () => {
    const opts = (threadId: string) => ({ settings: { botRail: true }, context: { threadId }, sidebarThreads: { threads, projects }, sdk: { plugins: { callRpc: async <T,>() => ({ bots: [bot] }) as T } } });
    setRailScope("personal");
    const onCoordinator = renderSlot(navigation, props, opts("coordinator"));
    const tile = await screen.findByRole("button", { name: /Personal Bot, Idle: show all threads/ });
    fireEvent.click(tile);
    expect(onCoordinator.navigateCalls).toEqual([]);
    expect(tile.getAttribute("aria-pressed")).toBe("false");
    cleanup();
    setRailScope("personal");
    const onWorker = renderSlot(navigation, props, opts("worker"));
    fireEvent.click(await screen.findByRole("button", { name: /Personal Bot, Idle: open coordinator/ }));
    expect(onWorker.navigateCalls).toEqual([{ method: "toThread", threadId: "coordinator" }]);
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("personal");
  });
  it.each([false, true])("toggles the crew overview from the rail and clears it via Home (compact=%s)", async compact => {
    const slot = mountBots(true, compact);
    const crew = await screen.findByRole("button", { name: "Crew: every bot at a glance" });
    fireEvent.click(crew);
    expect(crew.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("__crew__");
    expect(slot.container.querySelector(".radar-double-heading")).toBeNull();
    expect(slot.navigateCalls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(crew.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(crew);
    fireEvent.click(screen.getByRole("button", { name: "Crew: show all threads" }));
    expect(crew.getAttribute("aria-pressed")).toBe("false");
  });
  it("releases the selected filter immediately when the experiment is switched off", async () => {
    const slot = mountBots(true);
    fireEvent.click(await screen.findByRole("button", { name: /Personal Bot, Idle:/ }));
    host.botRail = false;
    slot.rerender(createElement(navigation.component, props));
    expect(screen.queryByRole("group", { name: "Bots" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Personal Bot" })).toBeNull();
    expect(slot.container.querySelector(".radar-double-heading")).toBeNull();
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
  });
  it("follows the current coordinator after rollover without changing the selected key", async () => {
    let current = bot;
    const slot = renderSlot(navigation, props, { settings: { botRail: true }, sidebarThreads: { threads, projects }, sdk: {
      plugins: { callRpc: async <T,>() => ({ bots: [current] }) as T }, threads: { output: async () => ({ output: "Nothing to do." }), context: async () => ({ usage: null }) },
    } });
    fireEvent.click(await screen.findByRole("button", { name: /Personal Bot, Idle:/ }));
    current = { ...bot, current: "replacement" };
    host.sidebarThreads = { threads: [makeThread({ id: "replacement", projectId: "proj_a" })], projects };
    slot.rerender(createElement(navigation.component, props));
    fireEvent.click(await screen.findByRole("button", { name: /Personal Bot, Idle:/ }));
    await waitFor(() => expect(slot.navigateCalls.at(-1)).toEqual({ method: "toThread", threadId: "replacement" }));
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("personal");
  });
});

describe("railNav layout setting", () => {
  it.each([false, true])("keeps the published slot and normal navigation when off (compact=%s)", (compact) => {
    expect(navigation.id).toBe("radar");
    expect(app.experimentalSidebarNavigations).toHaveLength(1);
    host.railNav = false;
    const newThread: ExperimentalSidebarNavigationItem = { ...destination("new", "New thread"), action: { kind: "new-thread" }, pluginId: null };
    const slot = mount([newThread, destination("notes", "Notes"), destination("hidden", "Hidden", false)], compact);
    expect(slot.container.querySelector(".radar-double-navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customize sidebar" })).toBeNull();
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map(b => b.getAttribute("aria-label")))
      .toEqual(["New thread", "Notes", "More navigation, 1 items"]);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(slot.inspection.sidebarNavigationCalls).toEqual([{ method: "activate", itemId: newThread.id, openInSplit: false }]);
    expect(Boolean(slot.container.querySelector(".radar-nav-compact"))).toBe(compact);
  });

  it("releases tooltip timers, overlays and layout reservations when disabled, then restores the rail", () => {
    const slot = mount([destination("notes", "Notes"), destination("hidden", "Hidden", false)]);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "More navigation, 1 items" }));
    expect(screen.getByRole("group", { name: "More navigation" })).toBeTruthy();
    host.railNav = false;
    slot.rerender(createElement(navigation.component, props));
    expect(slot.container.querySelector(".radar-double-navigation")).toBeNull();
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--radar-rail-reserve")).toBe("");
    expect(railHostStyles()).toEqual([]);
    host.railNav = true;
    slot.rerender(createElement(navigation.component, props));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(railHostStyles().map((style) => style.textContent)).toEqual([railHostCss({ wide: false, compact: false })]);
    expect(screen.queryByRole("group", { name: "More navigation" })).toBeNull();
  });

  it("ignores a saved wide choice and wideRail when railNav is off", () => {
    host.railNav = false;
    localStorage.setItem("radar-sidebar:rail-wide:v1", "1");
    renderSlot(navigation, props, { sidebarNavigation: { items: [destination("notes", "Notes")] }, settings: { wideRail: true } });
    expect(document.querySelector(".radar-double-navigation-wide")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide labels" })).toBeNull();
  });
});

describe("host styles", () => {
  // The rail restyles BB's sidebar from <style> elements in its own markup.
  // It never writes to BB's elements: :has() on body or the sidebar made the
  // browser restyle the page on every DOM change, and attributes on BB's
  // elements edited host DOM.
  function shell(p: ExperimentalSidebarNavigationProps) {
    return createElement(
      "div", { className: "group peer", "data-state": "expanded" },
      createElement(
        "div", { style: { "--sidebar-width": "320px" } as React.CSSProperties },
        createElement("div", { "data-sidebar": "sidebar" }, createElement(navigation.component, p), createElement("div", { "data-sidebar": "footer" })),
      ),
    );
  }
  const hostSheet = () => document.querySelector<HTMLStyleElement>(".radar-double-navigation > style")?.textContent ?? null;

  it("follows the rail's state without ever writing to BB's elements, and releases on unmount", () => {
    host.sidebarThreads = { status: "ready", projects: [makeProject({ id: "proj_a", name: "Alpha" })], threads: [makeThread({ id: "a", projectId: "proj_a" })] };
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(document.documentElement, { attributes: true, subtree: true });
    const slot = renderSlot({ ...navigation, component: shell }, props, { sidebarNavigation: { items: [destination("board", "Board")] }, settings: { wideRail: true } });
    const peer = document.querySelector<HTMLElement>(".group.peer")!;
    const bbElements = [document.documentElement, document.body, peer, peer.firstElementChild!, document.querySelector('[data-sidebar="sidebar"]')!, document.querySelector('[data-sidebar="footer"]')!];
    const state = { wide: false, compact: false };
    expect(hostSheet()).toBe(railHostCss(state));

    openMore();
    fireEvent.click(screen.getByRole("button", { name: "Show labels" }));
    expect(hostSheet()).toBe(railHostCss({ ...state, wide: true }));
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
    slot.rerender(createElement(shell, { ...props, isCompactViewport: true }));
    expect(hostSheet()).toBe(railHostCss({ ...state, compact: true }));

    slot.lifecycle.unmount();
    expect(railHostStyles()).toEqual([]);
    writes.push(...observer.takeRecords());
    observer.disconnect();
    expect(writes.filter((record) => bbElements.includes(record.target as Element)).map((record) => record.attributeName)).toEqual([]);
  });


});
