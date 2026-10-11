import { recordedActions, threadActionsFixture } from "./threadActions.fixtures";
// @vitest-environment jsdom
import { act, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createElement, Fragment, type FunctionComponent } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot, type TestThreadActionsResolver } from "@get-bb/plugin-sdk/testing/app";
import * as pluginSdk from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { DAY, HOUR, NOW, makeProject, makeSection, makeThread } from "./fixtures";
import { resetRailScope, setRailScope } from "./railScope";
import { hideBot, resetHiddenBots } from "./botVisibility";

// Expose configurable test exports while retaining the SDK's slot runtime.
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof pluginSdk>(),
}));

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

/** Stub the SDK areas the list touches. Intentionally partial: only the
 * methods under test are implemented, and the cast keeps the harness's
 * exhaustive fake tree from dictating fixtures this suite never calls. */
function sdkFakes(
  execution: Record<string, unknown> | null = null,
): Record<string, unknown> {
  return {
    threads: {
      defaultExecutionOptions: async () => execution,
      update: async () => ({ ok: true }),
      pin: async () => ({ ok: true }),
      unpin: async () => ({ ok: true }),
      markUnread: async () => ({ ok: true }),
      unarchive: async () => ({ ok: true }),
      markRead: async () => ({ ok: true }),
      context: async () => ({ usage: null }),
    },
    providers: { models: async () => ({ models: [] }) },
    system: {
      uiPreferences: {
        list: async () => ({ preferences: {} }),
        set: async () => ({ revision: 1, value: [] }),
      },
    },
  };
}

function renderThreads(
  threads: PluginSidebarThread[],
  options: {
    settings?: Record<string, string | number | boolean>;
    projects?: ReturnType<typeof makeProject>[];
    sections?: ReturnType<typeof makeSection>[];
    execution?: Record<string, unknown> | null;
    archived?: PluginSidebarThreadsState["experimental_archived"];
    sdk?: Record<string, unknown>;
    rpc?: Record<string, (input: unknown) => unknown>;
    isCompactViewport?: boolean;
    onNavigate?: () => void;
    threadActions?: TestThreadActionsResolver;
  } = {},
) {
  const { isCompactViewport = false, onNavigate = () => {}, ...harness } = options;
  const actions = threadActionsFixture();
  return actions.capture(renderSlot(
    threadList,
    {
      activeThreadId: null,
      activeProjectId: "proj_a",
      isCompactViewport,
      onNavigate,
      searchQuery: "",
    },
    {
      sdk: sdkFakes(options.execution),
      threadActions: actions.threadActions,
      ...harness,
      sidebarThreads: {
        status: "ready",
        threads,
        projects: options.projects ?? [makeProject({ id: "proj_a" })],
        sections: options.sections ?? [],
        experimental_archived: options.archived ?? null,
      },
    },
  ));
}

/** Row anchors are the stable handle: ThreadTitle renders empty in the
 * harness, so title text is not queryable — the id attribute is. */
/** List settings sit in the panel behind the header's View options button. */
function viewOptions() {
  if (!screen.queryByRole("dialog", { name: "View options" })) {
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
  }
  return within(screen.getByRole("dialog", { name: "View options" }));
}

function visibleRowIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("[data-sidebar-thread-id]"),
  ).map((node) => node.getAttribute("data-sidebar-thread-id") ?? "");
}

/** Rows bb would number for the ⌘/Ctrl jump keys, in DOM order. */
function shortcutTargetIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll("[data-sidebar-thread-shortcut-target]"),
  ).map((node) => node.getAttribute("data-sidebar-thread-id") ?? "");
}

// jsdom has no layout, so keyboard navigation has nothing to scroll.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  resetRailScope();
  resetHiddenBots();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared thread actions", () => {
  it.each(["More", "context"])("includes another plugin's action in the %s menu", (surface) => {
    const run = vi.fn(async (_threadId: string) => {});
    const core = threadActionsFixture();
    const slot = renderThreads([makeThread({ id: "notifications-thread" })], {
      threadActions: (thread, options) => [
        ...core.threadActions(thread, options),
        { key: "push-notifications/notifications", pluginId: "push-notifications", group: "3_preferences", action: {
          label: "Notifications", icon: "Bell", run: async () => run(thread.id),
        } },
      ],
    });
    if (surface === "More") fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    else fireEvent.contextMenu(slot.container.querySelector("[data-sidebar-thread-id]")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Notifications" }));
    expect(run).toHaveBeenCalledWith("notifications-thread");
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("opens Radar's inline editor through the host Rename action", async () => {
    renderThreads([makeThread({ id: "rename-thread", title: "Before" })]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue("Before")));
  });
});

describe("retired project tile scope", () => {
  it("never applies a legacy project filter, with or without the bot experiment", () => {
    localStorage.setItem("radar-sidebar:rail-scope:v1", "proj_a");
    const threads = [makeThread({ id: "a", projectId: "proj_a" }), makeThread({ id: "b", projectId: "proj_b" })];
    const slot = renderThreads(threads, { settings: { railNav: true }, projects: [makeProject({ id: "proj_a" }), makeProject({ id: "proj_b" })] });
    expect(visibleRowIds(slot.container).sort()).toEqual(["a", "b"]);
  });
});

describe("bot scope and experiment fallback", () => {
  const bot = { key: "personal", name: "Personal Bot", current: "root", projectId: "proj_a", projects: ["proj_b"], hostId: "host_1", providerId: "pi", model: "test", rollover: null };
  const projects = ["proj_a", "proj_b", "elsewhere", "other"].map(id => makeProject({ id }));
  const threads = [
    makeThread({ id: "root", projectId: "proj_a", pinnedAt: NOW }),
    makeThread({ id: "owned", projectId: "proj_b" }),
    makeThread({ id: "worker", projectId: "elsewhere", lifecycleOwnerThreadId: "root" }),
    makeThread({ id: "hidden", projectId: "elsewhere", parentThreadId: "root", isHidden: true }),
    makeThread({ id: "other", projectId: "other" }),
  ];
  const sdk = { ...sdkFakes(), plugins: { callRpc: async () => ({ bots: [bot] }) } };
  it("keeps bot shortcuts usable without the retired navigation setting", async () => {
    const navigated = vi.fn();
    const slot = renderThreads(threads, { projects, sdk, settings: { railNav: false, botRail: true }, isCompactViewport: true, onNavigate: navigated });
    const shortcuts = await screen.findByRole("group", { name: "Bot shortcuts" });
    fireEvent.click(within(shortcuts).getByRole("button", { name: /Personal Bot,/ }));
    expect(recordedActions(slot)).toContainEqual({ method: "open", threadId: "root" });
    expect(navigated).toHaveBeenCalledOnce();
    expect(visibleRowIds(slot.container)).toEqual(["worker"]);
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("personal");
    fireEvent.click(within(shortcuts).getByRole("button", { name: "All threads" }));
    expect(visibleRowIds(slot.container).sort()).toEqual(["other", "owned"]);
  });
  it("traverses bot shortcuts from the keyboard without acting on a thread row", async () => {
    const slot = renderThreads(threads, { projects, sdk, settings: { botRail: true } });
    const shortcuts = await screen.findByRole("group", { name: "Bot shortcuts" });
    const home = within(shortcuts).getByRole("button", { name: "All threads" });
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(shortcuts).getByRole("button", { name: /Personal Bot,/ }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Personal Bot");
    expect(recordedActions(slot)).toEqual([]);
  });
  it("preserves desktop bot details and closes them with Escape", async () => {
    renderThreads(threads, { projects, sdk, settings: { botRail: true, hoverCard: false } });
    const shortcuts = await screen.findByRole("group", { name: "Bot shortcuts" });
    const button = within(shortcuts).getByRole("button", { name: /Personal Bot,/ });
    button.focus();
    const card = await screen.findByRole("dialog", { name: "Personal Bot details" });
    expect(within(card).getByRole("region", { name: "Workers" })).toBeTruthy();
    expect(within(card).getByRole("region", { name: "Context usage" })).toBeTruthy();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(document.activeElement).toBe(card.querySelector("a"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Personal Bot details" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it("keeps a hidden bot shortcut accessible for an unread failure", async () => {
    hideBot("personal");
    renderThreads(threads.map(thread => thread.id === "root" ? { ...thread, status: "error" as const, isUnread: true } : thread),
      { projects, sdk, settings: { botRail: true } });
    const shortcuts = await screen.findByRole("group", { name: "Bot shortcuts" });
    expect(within(shortcuts).getByRole("button", { name: /Personal Bot, Failed · Unread reply/ })).toBeTruthy();
  });
  it("tucks pinned coordinators and workers into the rail, selects only workers, and preserves unrelated threads", async () => {
    setRailScope("personal");
    const slot = renderThreads(threads, { projects, sdk, settings: { railNav: true, botRail: true } });
    await waitFor(() => expect(visibleRowIds(slot.container).sort()).toEqual(["worker"]));
    expect(slot.container.querySelector(".radar-bot-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear bot filter: Personal Bot" }));
    expect(visibleRowIds(slot.container).sort()).toEqual(["other", "owned"]);
  });
  it("keeps the main header in a bot or crew scope, with the scope as a pill", async () => {
    setRailScope("personal");
    const slot = renderThreads(threads, { projects, sdk, settings: { railNav: true, botRail: true } });
    const pill = await screen.findByRole("button", { name: "Clear bot filter: Personal Bot" });
    expect(pill.closest(".radar-active-filters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Personal Bot" }).textContent).toContain("Personal");
    expect(screen.getByRole("searchbox", { name: "Filter threads" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View options" })).toBeTruthy();

    // A saved scope from the retired in-list Crew view names no bot: every thread shows, no pill.
    act(() => setRailScope("__crew__"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Clear bot filter/ })).toBeNull());
    expect(visibleRowIds(slot.container)).toContain("other");
  });
  it("opens the coordinator from the scope pill's name, keeping the scope", async () => {
    setRailScope("personal");
    const navigated = vi.fn();
    const slot = renderThreads(threads, { projects, sdk, settings: { railNav: true, botRail: true }, onNavigate: navigated });
    fireEvent.click(await screen.findByRole("button", { name: "Open Personal Bot" }));
    expect(recordedActions(slot)).toContainEqual({ method: "open", threadId: "root" });
    expect(navigated).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Clear bot filter: Personal Bot" })).toBeTruthy();
  });
  it("offers the coordinator when a bot has no workers", async () => {
    setRailScope("personal");
    const slot = renderThreads(threads.filter(thread => thread.id !== "worker"), { projects, sdk, settings: { railNav: true, botRail: true } });
    fireEvent.click(await screen.findByRole("button", { name: "Open Personal" }));
    expect(recordedActions(slot)).toContainEqual({ method: "open", threadId: "root" });
  });
  it("shows a bot's working threads in its view, and hides them again outside it", async () => {
    const running = threads.map(thread => thread.id === "worker" || thread.id === "other" ? { ...thread, status: "active" as const } : thread);
    setRailScope("personal");
    const slot = renderThreads(running, { projects, sdk, settings: { railNav: true, botRail: true, hideWorking: true } });
    await waitFor(() => expect(visibleRowIds(slot.container)).toEqual(["worker"]));
    expect(slot.container.querySelector(".radar-working-drawer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear bot filter: Personal Bot" }));
    expect(visibleRowIds(slot.container)).toEqual(["owned"]);
    expect(screen.getByRole("button", { name: "Working, 1 thread" })).toBeTruthy();
  });
  it("asks the server which bots are waiting on Salem and shows it on their faces", async () => {
    const plain = { ...bot, key: "plain", name: "Plain Bot", current: "plain", projects: [] };
    const crewThreads = [
      makeThread({ id: "root", projectId: "proj_a", latestAttentionAt: 100 }),
      makeThread({ id: "plain", projectId: "proj_a", latestAttentionAt: 200 }),
    ];
    const fakes = sdkFakes();
    const crewSdk = {
      ...fakes,
      threads: { ...(fakes.threads as object), output: async ({ threadId }: { threadId: string }) => ({ output: threadId === "plain" ? "Tickets are EGP 800.\nShould I book two for Saturday?" : "Inbox is clear." }) },
      plugins: { callRpc: async ({ pluginId }: { pluginId: string }) => pluginId === "orchestrator-mode" ? { bots: [bot, plain] } : { automations: [] } },
    };
    const asked: unknown[] = [];
    renderThreads(crewThreads, { projects, sdk: crewSdk, settings: { railNav: true, botRail: true }, rpc: {
      crew_asks: (raw) => {
        const input = raw as { threads: { threadId: string; version: number }[] };
        asked.push(input);
        return { judgements: input.threads.map(({ threadId, version }) => threadId === "plain"
          ? { threadId, version, waiting: 0.94, ask: "Should I book two for Saturday?" }
          : { threadId, version, waiting: 0.03, ask: null }) };
      },
    } });
    // Roster, pulses and the judgement arrive in turn; poll the DOM cheaply, then query by role once.
    await waitFor(() => expect(screen.getByRole("button", { name: /^Plain Bot, Decision/ })).toBeTruthy(), { timeout: 4_000, interval: 100 });
    expect(screen.getByRole("button", { name: /^Personal Bot, Idle/ })).toBeTruthy();
    expect(asked).toEqual([{ threads: [{ threadId: "root", version: 100 }, { threadId: "plain", version: 200 }] }]);
  }, 15_000);
  it("ignores a saved bot filter when bot shortcuts are off", async () => {
    const settings = { botRail: false };
    setRailScope("personal");
    const slot = renderThreads(threads, { projects, sdk, settings: { ...settings, botsDeck: false } });
    await act(async () => {});
    expect(visibleRowIds(slot.container).sort()).toEqual(["other", "owned", "root", "worker"]);
    expect(screen.queryByRole("button", { name: /Clear bot filter/ })).toBeNull();
  });
  it("restores all threads and the deck when the switch changes on a mounted list", async () => {
    const settings = vi.spyOn(pluginSdk, "useSettings");
    settings.mockReturnValue({ values: { railNav: true, botRail: true }, isLoading: false });
    setRailScope("personal");
    const slot = renderThreads(threads, { projects, sdk });
    await waitFor(() => expect(visibleRowIds(slot.container).sort()).toEqual(["worker"]));
    settings.mockReturnValue({ values: { railNav: true, botRail: false }, isLoading: false });
    slot.rerender(createElement(threadList.component, { activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false, onNavigate: () => {}, searchQuery: "" }));
    expect(slot.container.querySelector(".radar-bot-card[data-thread-id='root']")).toBeTruthy();
    expect(visibleRowIds(slot.container)).toContain("other");
    expect(screen.queryByRole("button", { name: /Clear bot filter/ })).toBeNull();
  });
  it("leaves the entire list accessible when the roster fails", async () => {
    setRailScope("personal");
    const slot = renderThreads(threads, { projects, settings: { railNav: true, botRail: true }, sdk: { ...sdkFakes(), plugins: { callRpc: async () => { throw new Error("Unavailable"); } } } });
    await act(async () => {});
    expect(visibleRowIds(slot.container).sort()).toEqual(["other", "owned", "root", "worker"]);
  });
});

describe("bots deck hiding and asks", () => {
  const bot = { key: "personal", name: "Personal Bot", current: "root", projectId: "proj_a", projects: [], hostId: "host_1", providerId: "pi", model: "test", rollover: null };
  const plain = { ...bot, key: "plain", name: "Plain Bot", current: "plain" };
  const projects = ["proj_a", "elsewhere", "other"].map(id => makeProject({ id }));
  const deckThreads = [
    makeThread({ id: "root", projectId: "proj_a", pinnedAt: NOW, latestAttentionAt: 100 }),
    makeThread({ id: "worker", projectId: "elsewhere", lifecycleOwnerThreadId: "root" }),
    makeThread({ id: "other", projectId: "other" }),
  ];
  const deckSdk = (output: Record<string, string> = {}) => {
    const fakes = sdkFakes();
    return {
      ...fakes,
      threads: { ...(fakes.threads as object), output: async ({ threadId }: { threadId: string }) => ({ output: output[threadId] ?? "Inbox is clear.\nNothing to do." }) },
      plugins: { callRpc: async () => ({ bots: [bot, plain] }) },
    };
  };
  const rpc = { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }) };
  /** The card's state class, or null when the bot has no card. */
  const cardState = (container: HTMLElement, id: string) => {
    const card = container.querySelector(`.radar-bot-card[data-thread-id='${id}']`);
    if (!card) return null;
    const skip = new Set(["radar-bot-card", "radar-bot-unread", "radar-bot-motion"]);
    return Array.from(card.classList).find(name => name.startsWith("radar-bot-") && !skip.has(name))?.slice("radar-bot-".length) ?? "none";
  };

  it("takes a hidden bot's whole family out of the deck instead of showing its coordinator as a pinned row", async () => {
    hideBot("personal");
    const slot = renderThreads([...deckThreads, makeThread({ id: "plain", projectId: "proj_a" })], { projects, sdk: deckSdk(), rpc, settings: { railNav: false, botsDeck: true } });
    await waitFor(() => expect(cardState(slot.container, "plain")).toBe("idle"));
    expect(slot.container.querySelector(".radar-bot-card[data-thread-id='root']")).toBeNull();
    expect(visibleRowIds(slot.container)).toEqual(["other"]);
    expect(screen.getByRole("button", { name: "Show Personal Bot again" })).toBeTruthy();
    // Showing it again brings the card and its workers back.
    fireEvent.click(screen.getByRole("button", { name: "Show Personal Bot again" }));
    await waitFor(() => expect(cardState(slot.container, "root")).toBe("idle"));
    expect(visibleRowIds(slot.container)).toEqual(["worker", "other"]);
  });
  it("reads the shared ask record: a Done ask no longer says Decision, a judged plain ask does", async () => {
    const threads = [...deckThreads, makeThread({ id: "plain", projectId: "proj_a", latestAttentionAt: 200 })];
    const sdk = deckSdk({ root: "Deploy paused.\nDecision needed: type your sudo password", plain: "Tickets are EGP 800.\nShould I book two for Saturday?" });
    const slot = renderThreads(threads, { projects, sdk, settings: { railNav: false, botsDeck: true }, rpc: {
      crew_needs_list: () => ({ items: [] }),
      crew_asks: () => ({ judgements: [
        { threadId: "root", version: 100, waiting: 0.99, ask: "Type your sudo password", itemId: "saved-root", dismissed: true },
        { threadId: "plain", version: 200, waiting: 0.94, ask: "Should I book two for Saturday?" },
      ] }),
    } });
    await waitFor(() => expect([cardState(slot.container, "root"), cardState(slot.container, "plain")]).toEqual(["idle", "decision"]), { timeout: 4_000, interval: 100 });
    const plainCard = slot.container.querySelector(".radar-bot-card[data-thread-id='plain']")!;
    expect(plainCard.querySelector(".radar-bot-chip")?.textContent).toBe("Decision");
    expect(plainCard.textContent).toContain("Should I book two for Saturday?");
    expect(slot.container.querySelector(".radar-bot-card[data-thread-id='root'] .radar-bot-chip")).toBeNull();
  });
  it("keeps a hidden bot out of sight after its failed worker is read, and in sight while the failure is unread", async () => {
    hideBot("personal");
    const failed = deckThreads.map(thread => thread.id === "worker" ? { ...thread, status: "error" as const, isUnread: false } : thread);
    const slot = renderThreads([...failed, makeThread({ id: "plain", projectId: "proj_a" })], { projects, sdk: deckSdk(), rpc, settings: { railNav: false, botsDeck: true } });
    await waitFor(() => expect(cardState(slot.container, "plain")).toBe("idle"));
    expect(cardState(slot.container, "root")).toBeNull();
    expect(visibleRowIds(slot.container)).toEqual(["other"]);
    expect(screen.getByRole("button", { name: "Show Personal Bot again" })).toBeTruthy();

    slot.unmount();
    // The same failure, still unread, keeps the hidden bot's card in view.
    const unreadFailure = failed.map(thread => thread.id === "worker" ? { ...thread, isUnread: true, indicator: "unread-error" as const } : thread);
    const unread = renderThreads([...unreadFailure, makeThread({ id: "plain", projectId: "proj_a" })], { projects, sdk: deckSdk(), rpc, settings: { railNav: false, botsDeck: true } });
    await waitFor(() => expect(cardState(unread.container, "root")).toBe("failed"));
    expect(visibleRowIds(unread.container)).toEqual(["worker", "other"]);
    expect(screen.queryByRole("button", { name: "Show Personal Bot again" })).toBeNull();
  });
  it("disables Hide while attention keeps the bot in view, and says why", async () => {
    const waiting = deckThreads.map(thread => thread.id === "worker" ? { ...thread, hasPendingInteraction: true, indicator: "waiting-for-input" as const } : thread);
    const slot = renderThreads([...waiting, makeThread({ id: "plain", projectId: "proj_a" })], { projects, sdk: deckSdk(), rpc, settings: { railNav: false, botsDeck: true } });
    await waitFor(() => expect(cardState(slot.container, "root")).toBe("needs-you"));
    fireEvent.contextMenu(slot.container.querySelector(".radar-bot-group[aria-label='Thread root']") ?? slot.container.querySelector(".radar-bot-card[data-thread-id='root']")!.closest(".radar-bot-group")!);
    const hide = screen.getByRole("menuitem", { name: "Hide Personal Bot" }) as HTMLButtonElement;
    expect(hide.disabled).toBe(true);
    expect(hide.title).toMatch(/before hiding it/);
    fireEvent.keyDown(document, { key: "Escape" });
    // A quiet bot can be hidden from the same menu.
    fireEvent.contextMenu(slot.container.querySelector(".radar-bot-card[data-thread-id='plain']")!.closest(".radar-bot-group")!);
    const hidePlain = screen.getByRole("menuitem", { name: "Hide Plain Bot" }) as HTMLButtonElement;
    expect(hidePlain.disabled).toBe(false);
    expect(hidePlain.title).toBe("");
    fireEvent.click(hidePlain);
    await waitFor(() => expect(cardState(slot.container, "plain")).toBeNull());
    expect(screen.getByRole("button", { name: "Show Plain Bot again" })).toBeTruthy();
  });
});

describe("grouping", () => {
  it("groups by activity so merely reading a thread does not float it to Today", () => {
    const visited = makeThread({
      id: "visited",
      title: "Old but just opened",
      updatedAt: NOW,
      lastReadAt: NOW,
      latestAttentionAt: NOW - 60 * DAY,
    });
    renderThreads([visited]);

    expect(screen.getByText("Old but just opened")).toBeTruthy();
    // It must sit under "Older", never under Today.
    const headers = screen
      .getAllByText(/today|yesterday|previous|older/i)
      .map((node) => node.textContent);
    expect(headers).toContain("Older");
    expect(headers).not.toContain("Today");
  });

  it("floats a working thread into Today", () => {
    const working = makeThread({
      id: "working",
      title: "Currently running",
      status: "active",
      indicator: "runtime",
      latestAttentionAt: NOW - 60 * DAY,
    });
    renderThreads([working]);
    const headers = screen
      .getAllByText(/today|yesterday|previous|older/i)
      .map((node) => node.textContent);
    expect(headers).toContain("Today");
  });
});

describe("thread families", () => {
  it("nests a child under its parent instead of listing it separately", () => {
    const parent = makeThread({ id: "p", title: "Parent task" });
    const child = makeThread({ id: "c", title: "Child task", parentThreadId: "p" });
    renderThreads([child, parent]);

    const rows = screen.getAllByRole("link");
    const titles = rows.map((row) => row.getAttribute("aria-label") ?? "");
    // DOM order: parent immediately followed by its child.
    const parentIndex = titles.findIndex((t) => t.startsWith("Parent task"));
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(titles[parentIndex + 1]?.startsWith("Child task")).toBe(true);
  });

  it("folds descendants away when the parent collapses", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const child = makeThread({ id: "c", title: "Hidden kid", parentThreadId: "p" });
    const slot = renderThreads([parent, child]);

    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));

    // The fold hides its rows at once (visibility also drops them from tab
    // order) but keeps them mounted while the collapse animates, then lets
    // them go so a folded family costs nothing.
    const fold = slot.container.querySelector<HTMLElement>(".radar-fold-collapsed")!;
    expect(fold.getAttribute("aria-hidden")).toBe("true");
    expect(fold.querySelector('[data-sidebar-thread-id="c"]')).not.toBeNull();
    await waitFor(() => expect(visibleRowIds(slot.container)).toEqual(["p"]));

    // Opening mounts them again in the same commit, so the grid can grow.
    fireEvent.click(screen.getByRole("button", { name: "Expand replies" }));
    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);
  });

  it("keeps folded rows out of the jump shortcut numbering", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const child = makeThread({ id: "c", title: "Hidden kid", parentThreadId: "p" });
    const slot = renderThreads([parent, child]);
    const targetIds = () => shortcutTargetIds(slot.container);

    expect(targetIds()).toEqual(["p", "c"]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    await waitFor(() => expect(targetIds()).toEqual(["p"]));

    fireEvent.click(screen.getByRole("button", { name: "Expand replies" }));
    await waitFor(() => expect(targetIds()).toEqual(["p", "c"]));
  });

  it.each([
    ["search", () => fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "kid" },
    })],
    ["status filter", () => fireEvent.click(viewOptions().getByTitle("Filter unread threads"))],
  ])("numbers a folded family's rows while a %s forces it open", (_, filter) => {
    const parent = makeThread({ id: "p", title: "Family head kid", isUnread: true });
    const child = makeThread({
      id: "c",
      title: "Hidden kid",
      parentThreadId: "p",
      isUnread: true,
    });
    const slot = renderThreads([parent, child]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    expect(shortcutTargetIds(slot.container)).toEqual(["p"]);

    filter();
    expect(shortcutTargetIds(slot.container)).toEqual(["p", "c"]);
  });

  it("announces a fold only when it hides something that matters", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const quiet = makeThread({ id: "q", title: "Quiet kid", parentThreadId: "p" });
    const loud = makeThread({
      id: "u",
      title: "Unseen kid",
      parentThreadId: "p",
      isUnread: true,
      indicator: "unread-success",
    });
    const slot = renderThreads([parent, quiet, loud]);

    // Nothing announced while open.
    expect(slot.container.querySelector(".radar-kids-pill")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    await waitFor(() =>
      expect(slot.container.querySelector(".radar-fold-collapsed")).toBeTruthy(),
    );

    // One hidden row is unseen, so the pill appears and counts it.
    const pill = slot.container.querySelector(".radar-kids-pill");
    expect(pill?.textContent).toContain("1");
  });

  it("unfolds back to the full family", async () => {
    const parent = makeThread({ id: "p", title: "Family head" });
    const child = makeThread({ id: "c", title: "Shown kid", parentThreadId: "p" });
    const slot = renderThreads([parent, child]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    await waitFor(() =>
      expect(slot.container.querySelector(".radar-fold-collapsed")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand replies" }));
    await waitFor(() =>
      expect(
        slot.container.querySelector(".radar-fold-collapsed"),
      ).toBeNull(),
    );
    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);
  });

  it("promotes an orphan whose parent is absent to a root row", () => {
    const orphan = makeThread({
      id: "orphan",
      title: "Parentless child",
      parentThreadId: "does-not-exist",
    });
    renderThreads([orphan]);
    expect(screen.getByText("Parentless child")).toBeTruthy();
  });
});

describe("filtering", () => {
  it("keeps a matching child's ancestor context", () => {
    const parent = makeThread({ id: "p", title: "Umbrella" });
    const child = makeThread({
      id: "c",
      title: "Needle finding",
      parentThreadId: "p",
    });
    const slot = renderThreads([parent, child]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "needle" },
    });

    // Child matches, so both it and its parent stay rendered.
    expect(visibleRowIds(slot.container)).toEqual(["p", "c"]);
  });

  it("drops an ancestor branch that matches nothing", () => {
    const parent = makeThread({ id: "p", title: "Umbrella" });
    const child = makeThread({
      id: "c",
      title: "Needle finding",
      parentThreadId: "p",
    });
    const other = makeThread({ id: "x", title: "Unrelated" });
    const slot = renderThreads([parent, child, other]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "needle" },
    });

    expect(visibleRowIds(slot.container)).not.toContain("x");
  });

  it("matches case-insensitively against a capitalised title", () => {
    // Regression: `.toLowerCase()` once bound to only the last fragment of
    // the haystack, so lowercase queries never matched real titles.
    const thread = makeThread({ id: "t", title: "Umbrella Solo" });
    const slot = renderThreads([thread]);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "umbrella" },
    });

    expect(visibleRowIds(slot.container)).toEqual(["t"]);
  });

  it("says so when nothing matches", () => {
    renderThreads([makeThread({ id: "p", title: "Only one" })]);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText(/No threads match/)).toBeTruthy();
  });
});

describe("actions", () => {
  it("offers only ⋯ on the row, with pin, rename and archive in its menu", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "Act on me" })]);
    const strip = slot.container.querySelector(".radar-row-actions")!;
    expect(within(strip as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["More actions"]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    for (const name of ["Pin", "Rename", "Archive"]) {
      expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    }
  });

  it("routes archive from the ⋯ menu through the host", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "Archive me" })]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(recordedActions(slot)).toContainEqual({
      method: "archive",
      threadId: "t",
    });
  });

  it("routes pin from the ⋯ menu through the host", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "Pin me" })]);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(recordedActions(slot)).toContainEqual({ method: "setPinned", threadId: "t", pinned: true });
  });
});

describe("swipe actions", () => {
  const row = (container: HTMLElement) =>
    container.querySelector(".radar-row") as HTMLElement;

  function swipe(container: HTMLElement, dx: number, dy = 0) {
    const target = row(container);
    fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
    // Two steps: the first (just past the slop) decides swipe versus scroll.
    const step = 12 / Math.max(Math.abs(dx), Math.abs(dy));
    fireEvent.touchMove(target, {
      touches: [{ clientX: 150 + dx * step, clientY: 20 + dy * step }],
    });
    fireEvent.touchMove(target, {
      touches: [{ clientX: 150 + dx, clientY: 20 + dy }],
    });
    fireEvent.touchEnd(target, { touches: [] });
  }

  /** Settings loaded (none chosen), so the shipped swipe defaults apply. */
  const renderSwipe = (
    threads: PluginSidebarThread[],
    options: Parameters<typeof renderThreads>[1] = {},
  ) => renderThreads(threads, { settings: {}, ...options });

  const originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 300,
    });
  });
  afterAll(() => {
    // Rows have no layout in jsdom: do not leak a width into other suites.
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    }
  });

  it("marks read on a right swipe by default", () => {
    const slot = renderSwipe([
      makeThread({ id: "t", lastReadAt: null, latestAttentionAt: NOW }),
    ]);
    swipe(slot.container, 160);
    expect(recordedActions(slot)).toContainEqual(
      expect.objectContaining({ method: "setRead", threadId: "t" }),
    );
  });

  it("slides the row away, then archives on a left swipe by default", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      swipe(slot.container, -160);
      expect(row(slot.container).dataset.swipePhase).toBe("out");
      expect(recordedActions(slot)).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(recordedActions(slot)).toContainEqual({
        method: "archive",
        threadId: "t",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured action for each side", () => {
    const slot = renderSwipe([makeThread({ id: "t" })], {
      settings: { swipeLeft: "Pin / unpin" },
    });
    swipe(slot.container, -160);
    expect(recordedActions(slot)).toContainEqual({
      method: "setPinned",
      threadId: "t",
      pinned: true,
    });
  });

  it("does not treat a quick drag that then rests as a flick", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      const target = row(slot.container);
      fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
      for (let x = 138; x >= 90; x -= 12) {
        fireEvent.touchMove(target, { touches: [{ clientX: x, clientY: 20 }] });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      // Rest, then lift: short of the threshold, so nothing happens.
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.touchEnd(target, { touches: [] });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(recordedActions(slot)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back without acting on a short drag", () => {
    const slot = renderSwipe([makeThread({ id: "t" })]);
    swipe(slot.container, -30);
    expect(recordedActions(slot)).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBe("settle");
  });

  it("leaves vertical movement to the scroller", () => {
    const slot = renderSwipe([makeThread({ id: "t" })]);
    swipe(slot.container, -20, 160);
    expect(recordedActions(slot)).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBeUndefined();
  });

  /** A two-finger trackpad stream: pixel wheel events, ~16ms apart. */
  function wheelSwipe(container: HTMLElement, dx: number, dy = 0, steps = 10) {
    const target = row(container);
    for (let i = 0; i < steps; i += 1) {
      // Content-style deltas: fingers moving left scroll content right (+x).
      fireEvent.wheel(target, { deltaX: -dx / steps, deltaY: dy / steps, deltaMode: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  }

  /** The fade-out a trackpad sends after the fingers lift mid-flick. */
  function momentumTail(container: HTMLElement, direction: number) {
    const target = row(container);
    for (let d = 8; d >= 0.8; d *= 0.7) {
      fireEvent.wheel(target, { deltaX: -direction * d, deltaMode: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
  }

  it("rests a stopped trackpad swipe open, then follows on", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -60);
      // Resting fingers: no decision, the row just settles open.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(row(slot.container).dataset.swipePhase).toBe("open");
      expect(row(slot.container).style.transform).toContain("-96px");
      expect(recordedActions(slot)).toEqual([]);
      // Moving again carries on from there.
      wheelSwipe(slot.container, -100);
      momentumTail(slot.container, -1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(recordedActions(slot)).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  function openWithTrackpad(container: HTMLElement) {
    wheelSwipe(container, -60);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
  }

  it("runs the action from an open row's button", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      openWithTrackpad(slot.container);
      const button = slot.container.querySelector(".radar-swipe-underlay") as HTMLElement;
      fireEvent.pointerDown(button);
      fireEvent.click(button);
      expect(recordedActions(slot)).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["press elsewhere", "press on the row", "Escape", "scroll"])(
    "closes an open row on %s without acting",
    (how) => {
      vi.useFakeTimers();
      try {
        const slot = renderSwipe([makeThread({ id: "t" })], {
          settings: { swipeLeft: "Pin / unpin" },
        });
        openWithTrackpad(slot.container);
        const anchor = slot.container.querySelector("[data-sidebar-thread-id]") as HTMLElement;
        if (how === "press elsewhere") fireEvent.pointerDown(document.body);
        if (how === "press on the row") {
          fireEvent.pointerDown(anchor);
          fireEvent.click(anchor);
        }
        if (how === "Escape") fireEvent.keyDown(document, { key: "Escape" });
        if (how === "scroll") {
          fireEvent.scroll(slot.container.querySelector(".radar-list-body") as HTMLElement);
        }
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(row(slot.container).dataset.swipePhase).toBeUndefined();
        // The harness's split-drag stand-in logs any press on a row link as
        // "open"; the real host only drags once the pointer leaves the list.
        expect(
          recordedActions(slot).filter((call) => call.method !== "open"),
        ).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps only one row open", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe(
        [makeThread({ id: "a" }), makeThread({ id: "b" })],
        { settings: { swipeLeft: "Pin / unpin" } },
      );
      const rows = () =>
        Array.from(slot.container.querySelectorAll(".radar-row")) as HTMLElement[];
      const open = (target: HTMLElement) => {
        for (let i = 0; i < 10; i += 1) {
          fireEvent.wheel(target, { deltaX: 6, deltaMode: 0 });
          act(() => {
            vi.advanceTimersByTime(16);
          });
        }
        act(() => {
          vi.advanceTimersByTime(1500);
        });
      };
      open(rows()[0]);
      expect(rows()[0].dataset.swipePhase).toBe("open");
      open(rows()[1]);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(rows()[1].dataset.swipePhase).toBe("open");
      expect(rows()[0].dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Rest a row open with a short trackpad pull, as the open-row tests do. */
  function restOpen(target: HTMLElement) {
    for (let i = 0; i < 10; i += 1) {
      fireEvent.wheel(target, { deltaX: 6, deltaMode: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    act(() => {
      vi.advanceTimersByTime(1500);
    });
  }

  it("closes an open row as soon as another starts to swipe", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe(
        [makeThread({ id: "a" }), makeThread({ id: "b" })],
        { settings: { swipeLeft: "Pin / unpin" } },
      );
      const rows = Array.from(
        slot.container.querySelectorAll(".radar-row"),
      ) as HTMLElement[];
      restOpen(rows[0]);
      expect(rows[0].dataset.swipePhase).toBe("open");
      // A short pull on the other row: it will settle back, never opening.
      for (let i = 0; i < 4; i += 1) {
        fireEvent.wheel(rows[1], { deltaX: 4, deltaMode: 0 });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      expect(rows[1].dataset.swipePhase).toBe("drag");
      expect(rows[0].dataset.swipePhase).toBe("settle");
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(rows[0].dataset.swipePhase).toBeUndefined();
      expect(rows[1].dataset.swipePhase).not.toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("spends Escape on closing an open row, and no more", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      const target = row(slot.container);
      const behind = vi.fn();
      document.body.addEventListener("keydown", behind);
      try {
        restOpen(target);
        expect(target.dataset.swipePhase).toBe("open");
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(target.dataset.swipePhase).toBe("settle");
        expect(behind).not.toHaveBeenCalled();
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        // With nothing open, Escape is left for whoever else wants it.
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(behind).toHaveBeenCalledOnce();
      } finally {
        document.body.removeEventListener("keydown", behind);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not take a mouse wheel's sideways notches for a swipe", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      const target = row(slot.container);
      // A tilt wheel steps a whole notch at once, and is left to scroll.
      for (let i = 0; i < 4; i += 1) {
        const untouched = fireEvent.wheel(target, { deltaX: 100, deltaMode: 0 });
        expect(untouched).toBe(true);
        act(() => {
          vi.advanceTimersByTime(60);
        });
      }
      // Shift+wheel is a mouse's way of scrolling sideways, in any step size.
      for (let i = 0; i < 10; i += 1) {
        const untouched = fireEvent.wheel(target, {
          deltaX: 12,
          shiftKey: true,
          deltaMode: 0,
        });
        expect(untouched).toBe(true);
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(recordedActions(slot)).toEqual([]);
      expect(target.dataset.swipePhase).toBeUndefined();
      expect(target.style.transform).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a trackpad flick as soon as its momentum fades", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -160);
      momentumTail(slot.container, -1);
      expect(recordedActions(slot)).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(recordedActions(slot)).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);

      // Stragglers from the tail must not start a second swipe.
      for (let i = 0; i < 20; i += 1) {
        fireEvent.wheel(row(slot.container), { deltaX: 6, deltaMode: 0 });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(recordedActions(slot)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a trackpad swipe going after the row slides out from under the cursor", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      // Starts over the row...
      wheelSwipe(slot.container, -40, 0, 4);
      expect(row(slot.container).dataset.swipePhase).toBe("drag");
      // ...then the cursor is over the list body instead.
      const elsewhere = slot.container.querySelector(".radar-list-body") as HTMLElement;
      for (let i = 0; i < 10; i += 1) {
        fireEvent.wheel(elsewhere, { deltaX: 16, deltaMode: 0 });
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      expect(row(slot.container).style.transform).toContain("-200px");
      momentumTail(slot.container, -1);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(recordedActions(slot)).toEqual([
        { method: "setPinned", threadId: "t", pinned: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back from a third of the row on a trackpad", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -100);
      expect("swipeArmed" in row(slot.container).dataset).toBe(false);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(recordedActions(slot)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("decides an abrupt stop only after a longer pause", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeLeft: "Pin / unpin" },
      });
      wheelSwipe(slot.container, -200);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(recordedActions(slot)).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(recordedActions(slot)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves vertical trackpad scrolling to the list", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      wheelSwipe(slot.container, -20, 200);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(recordedActions(slot)).toEqual([]);
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores pinch-zoom and line-stepped mouse wheels", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      const target = row(slot.container);
      for (let i = 0; i < 10; i += 1) {
        fireEvent.wheel(target, { deltaX: 30, ctrlKey: true, deltaMode: 0 });
        fireEvent.wheel(target, { deltaX: 3, deltaMode: 1 });
      }
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(recordedActions(slot)).toEqual([]);
      expect(target.dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turning swipe actions off stops trackpad swipes too", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeActions: false },
      });
      wheelSwipe(slot.container, -160);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(recordedActions(slot)).toEqual([]);
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when turned off", () => {
    const slot = renderSwipe([makeThread({ id: "t" })], {
      settings: { swipeActions: false },
    });
    swipe(slot.container, -160);
    expect(recordedActions(slot)).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBeUndefined();
    expect(slot.container.querySelector("[data-radar-swipe=\"off\"]")).not.toBeNull();
  });
  it("waits for the saved settings before a swipe can act", () => {
    // No `settings`: still loading, so a swipe must not run on the defaults.
    const slot = renderThreads([makeThread({ id: "t" })]);
    swipe(slot.container, -160);
    expect(recordedActions(slot)).toEqual([]);
    expect(row(slot.container).dataset.swipePhase).toBeUndefined();
  });

  it("lets a locked drag go home when a second finger lands", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      const target = row(slot.container);
      fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
      fireEvent.touchMove(target, { touches: [{ clientX: 138, clientY: 20 }] });
      fireEvent.touchMove(target, { touches: [{ clientX: 118, clientY: 20 }] });
      expect(target.dataset.swipePhase).toBe("drag");
      fireEvent.touchStart(target, {
        touches: [
          { clientX: 118, clientY: 20 },
          { clientX: 200, clientY: 20 },
        ],
      });
      fireEvent.touchEnd(target, { touches: [{ clientX: 200, clientY: 20 }] });
      expect(target.dataset.swipePhase).toBe("settle");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(target.dataset.swipePhase).toBeUndefined();
      expect(target.style.transform).toBe("");
      // The row answers the next swipe as usual.
      swipe(slot.container, -160);
      expect(target.dataset.swipePhase).toBe("out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles without acting when the touch is cancelled", () => {
    const slot = renderSwipe([makeThread({ id: "t" })]);
    const target = row(slot.container);
    fireEvent.touchStart(target, { touches: [{ clientX: 150, clientY: 20 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 138, clientY: 20 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchCancel(target, { touches: [] });
    expect(target.dataset.swipePhase).toBe("settle");
    expect(recordedActions(slot)).toEqual([]);
  });

  it("leaves a touch on the drag grip to its section drag", () => {
    const slot = renderSwipe([makeThread({ id: "t" })]);
    const target = row(slot.container);
    const grip = document.createElement("button");
    grip.className = "radar-row-grip";
    target.appendChild(grip);
    fireEvent.touchStart(grip, { touches: [{ clientX: 150, clientY: 20 }] });
    fireEvent.touchMove(grip, { touches: [{ clientX: 138, clientY: 20 }] });
    fireEvent.touchMove(grip, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchEnd(grip, { touches: [] });
    expect(recordedActions(slot)).toEqual([]);
    expect(target.dataset.swipePhase).toBeUndefined();
  });

  it("still archives when the row unmounts while it slides away", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      swipe(slot.container, -160);
      expect(row(slot.container).dataset.swipePhase).toBe("out");
      act(() => {
        slot.unmount();
      });
      expect(recordedActions(slot)).toEqual([
        { method: "archive", threadId: "t" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("brings a removed row back if the host kept it", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t" })]);
      swipe(slot.container, -160);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(row(slot.container).dataset.swipePhase).toBe("gone");
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(row(slot.container).dataset.swipePhase).toBe("settle");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(row(slot.container).dataset.swipePhase).toBeUndefined();
      expect(row(slot.container).style.height).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fold away a parent whose archive the host may confirm", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([
        makeThread({ id: "p" }),
        makeThread({ id: "c", parentThreadId: "p" }),
      ]);
      swipe(slot.container, -160);
      expect(recordedActions(slot)).toEqual([
        { method: "archive", threadId: "p" },
      ]);
      expect(row(slot.container).dataset.swipePhase).toBe("settle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a parent in place when a search hides its replies", () => {
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([
        makeThread({ id: "p", title: "Umbrella needle" }),
        makeThread({ id: "c", title: "Other", parentThreadId: "p" }),
      ]);
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "needle" },
      });
      expect(visibleRowIds(slot.container)).toEqual(["p"]);
      swipe(slot.container, -160);
      // The host still confirms archiving the replies it cannot see here.
      expect(recordedActions(slot)).toEqual([
        { method: "archive", threadId: "p" },
      ]);
      expect(row(slot.container).dataset.swipePhase).toBe("settle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores an archived thread from the Archived view", () => {
    localStorage.setItem("radar-sidebar:lifecycles:v1", "archived");
    vi.useFakeTimers();
    try {
      const slot = renderSwipe([makeThread({ id: "t", isArchived: true })]);
      swipe(slot.container, -160);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(slot.inspection.sdkCalls).toContainEqual(
        expect.objectContaining({ method: "threads.unarchive" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back instead of folding on the All view", () => {
    localStorage.setItem("radar-sidebar:lifecycles:v1", "all");
    const slot = renderSwipe([makeThread({ id: "t" })]);
    swipe(slot.container, -160);
    expect(recordedActions(slot)).toEqual([
      { method: "archive", threadId: "t" },
    ]);
    expect(row(slot.container).dataset.swipePhase).toBe("settle");
  });

  it("opens the native More menu from either swipe direction", async () => {
    const place = async (dx: number) => {
      const slot = renderSwipe([makeThread({ id: "t" })], {
        settings: { swipeRight: "More actions", swipeLeft: "More actions" },
      });
      swipe(slot.container, dx);
      const menu = await screen.findByRole("menu");
      expect(row(slot.container).style.transform).toBe("");
      // The harness renders its menu inside the row instead of a host portal.
      await waitFor(() => {
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive" }));
        expect(recordedActions(slot)).toContainEqual({ method: "archive", threadId: "t" });
      });
      cleanup();
    };
    await place(160);
    await place(-160);
  });
});

describe("density", () => {
  const root = (slot: { container: HTMLElement }) =>
    slot.container.querySelector(".radar-list") as HTMLElement;

  it("follows the server default when nothing was chosen locally", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "One" })], {
      settings: { defaultDensity: "compact" },
    });
    expect(root(slot).classList.contains("radar-density-compact")).toBe(true);
  });

  it("toggles compact on and back off", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "One" })]);
    expect(root(slot).classList.contains("radar-density-compact")).toBe(false);

    fireEvent.click(viewOptions().getByRole("button", { name: "Compact view" }));
    expect(root(slot).classList.contains("radar-density-compact")).toBe(true);

    fireEvent.click(viewOptions().getByRole("button", { name: "Comfortable view" }));
    expect(root(slot).classList.contains("radar-density-compact")).toBe(false);
  });

  it("releases the local override when toggled back onto the server default", () => {
    // Regression: a stored "compact" used to lock out the server setting
    // permanently, so the list could be stuck compact with no way back.
    const slot = renderThreads([makeThread({ id: "t", title: "One" })], {
      settings: { defaultDensity: "compact" },
    });
    // Server says compact, so the button offers the comfortable option.
    fireEvent.click(viewOptions().getByRole("button", { name: "Comfortable view" }));
    expect(localStorage.getItem("radar-sidebar:density:v1")).toBe(
      "comfortable",
    );

    // Toggling back onto the server default stores "auto", not an override.
    fireEvent.click(viewOptions().getByRole("button", { name: "Compact view" }));
    expect(localStorage.getItem("radar-sidebar:density:v1")).toBe("auto");
  });
});

describe("working drawer", () => {
  const threads = [
    makeThread({ id: "run", title: "Long refactor", status: "active" }),
    makeThread({ id: "done", latestAttentionAt: NOW - HOUR }),
  ];

  it("folds running threads into a drawer under the list and remembers it open", () => {
    const slot = renderThreads(threads, { settings: { hideWorking: true } });
    const drawer = slot.container.querySelector<HTMLElement>(".radar-working-drawer");
    expect(drawer?.previousElementSibling?.classList.contains("radar-list-body")).toBe(true);
    expect(visibleRowIds(slot.container)).toEqual(["done"]);
    const toggle = screen.getByRole("button", { name: "Working, 1 thread" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(visibleRowIds(drawer!)).toEqual(["run"]);
    expect(localStorage.getItem("radar-sidebar:working-open:v1")).toBe("open");
  });

  it("peeks into running threads on hover, with what each is doing", async () => {
    const navigated = vi.fn();
    const asked: unknown[] = [];
    const started = Date.now() - 20 * 60_000;
    const slot = renderThreads(threads, { settings: { hideWorking: true }, onNavigate: navigated, rpc: {
      working_digest: (input) => {
        asked.push(input);
        return { digests: [{
          threadId: "run", runningSince: started, lastActivityAt: Date.now() - 30_000,
          saying: "Running the tests now.", doing: { label: "Running command", detail: "npx vitest run", pending: true, at: Date.now() },
          phase: "testing", steps: 12, failingStreak: 2, todos: { done: 2, total: 5, current: "Fix the flaky test" },
          goal: null, context: 0.42, background: 0, fallback: null,
        }] };
      },
    } });
    const header = screen.getByRole("button", { name: "Working, 1 thread" }).closest(".radar-group-header")!.parentElement!;
    fireEvent.pointerEnter(header, { pointerType: "mouse" });
    const card = await screen.findByRole("dialog", { name: "Working threads" });
    await waitFor(() => expect(within(card).getByText("“Running the tests now.”")).toBeTruthy());
    expect(asked).toEqual([{ threadIds: ["run"] }]);
    expect(within(card).getByText("Long refactor")).toBeTruthy();
    expect(within(card).getByText("20m")).toBeTruthy();
    expect(within(card).getByText(/Testing · 12 steps · 42% context/)).toBeTruthy();
    expect(within(card).getByText("npx vitest run")).toBeTruthy();
    expect(within(card).getByText("2/5 · Fix the flaky test")).toBeTruthy();
    expect(within(card).getByText("2 failed commands in a row")).toBeTruthy();
    expect(within(card).getByText("1 failing")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: /Long refactor/ }));
    expect(recordedActions(slot)).toContainEqual({ method: "open", threadId: "run" });
    expect(navigated).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Working threads" })).toBeNull();
  });

  it("closes the peek when the pointer leaves, and never opens it on touch", async () => {
    renderThreads(threads, { settings: { hideWorking: true }, rpc: { working_digest: () => ({ digests: [] }) } });
    const header = screen.getByRole("button", { name: "Working, 1 thread" }).closest(".radar-group-header")!.parentElement!;
    fireEvent.pointerEnter(header, { pointerType: "mouse" });
    await screen.findByRole("dialog", { name: "Working threads" });
    fireEvent.pointerLeave(header);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Working threads" })).toBeNull());
    fireEvent.pointerEnter(header, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(screen.queryByRole("dialog", { name: "Working threads" })).toBeNull();
  });

  it("counts running threads in the drawer header, not their idle replies", () => {
    const family = [
      makeThread({ id: "lead", status: "active" }),
      makeThread({ id: "reply1", parentThreadId: "lead", isUnread: true, indicator: "unread-success" }),
      makeThread({ id: "reply2", parentThreadId: "lead" }),
      makeThread({ id: "busy", parentThreadId: "lead", status: "active" }),
    ];
    renderThreads([...family, threads[1]!], { settings: { hideWorking: true } });
    const toggle = screen.getByRole("button", { name: "Working, 2 threads" });
    expect(toggle.querySelector(".radar-group-count")?.textContent).toBe("2");
    expect(toggle.querySelector(".radar-group-unread")).toBeNull();
  });

  it("keeps a thread that left a background command running in the drawer", () => {
    const server = makeThread({ id: "server", activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 } });
    const slot = renderThreads([server, threads[1]!], { settings: { hideWorking: true } });
    expect(visibleRowIds(slot.container)).toEqual(["done"]);
    expect(screen.getByRole("button", { name: "Working, 1 thread" })).toBeTruthy();
  });

  it("shows waiting threads in their group when the needs-you lane is off", () => {
    const asking = makeThread({ id: "ask", hasPendingInteraction: true });
    const slot = renderThreads([asking, threads[1]!], { settings: { needsYouLane: false } });
    expect(visibleRowIds(slot.container).sort()).toEqual(["ask", "done"]);
    expect(slot.container.querySelector(".radar-group-needs-you")).toBeNull();
  });

  it("stays out of the way when the setting is off", () => {
    const slot = renderThreads(threads);
    expect(slot.container.querySelector(".radar-working-drawer")).toBeNull();
    expect(visibleRowIds(slot.container)).toEqual(["run", "done"]);
  });
});

describe("settings gates", () => {
  it("shows rows on the shipped defaults while settings load", () => {
    vi.spyOn(pluginSdk, "useSettings").mockReturnValue({
      values: undefined, isLoading: true,
    });
    const slot = renderThreads([makeThread({ id: "t" })]);
    expect(visibleRowIds(slot.container)).toEqual(["t"]);
    expect(screen.queryByRole("status", { name: "Loading threads" })).toBeNull();
    expect(slot.container.querySelector(".radar-title-wrap, .radar-density-compact"))
      .toBeNull();
  });

  it("paints the last-seen density and title mode while settings load", () => {
    // A first render on settings remembers them for this client...
    renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true, defaultDensity: "compact" },
    });
    cleanup();

    // ...so the next load sizes rows correctly before settings resolve.
    vi.spyOn(pluginSdk, "useSettings").mockReturnValue({
      values: undefined, isLoading: true,
    });
    const slot = renderThreads([makeThread({ id: "t" })]);
    expect(visibleRowIds(slot.container)).toEqual(["t"]);
    expect(slot.container.querySelector(".radar-title-wrap.radar-density-compact"))
      .not.toBeNull();
  });

  it("follows the loaded settings over the last-seen ones", () => {
    renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true, defaultDensity: "compact" },
    });
    cleanup();

    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: false },
    });
    expect(slot.container.querySelector(".radar-title-wrap, .radar-density-compact"))
      .toBeNull();
  });

  it.each([false, true])("owns all title segments when a mention is last: %s", (mentionLast) => {
    vi.spyOn(pluginSdk as typeof pluginSdk & {
      ThreadTitle: FunctionComponent<pluginSdk.PluginThreadTitleProps>;
    }, "ThreadTitle").mockImplementation(() => createElement(
      Fragment, null,
      createElement("span", null, "Fix checkout "),
      createElement("span", { "data-mention": "" }, "@checkout.test.ts"),
      mentionLast ? null : createElement("span", null, " that times out on CI"),
    ));
    const slot = renderThreads([makeThread({ id: "t", isPinned: true })], {
      settings: { twoLineTitles: true },
    });
    const title = slot.container.querySelector(".radar-thread-title");
    expect(title?.textContent).toBe(
      `Fix checkout @checkout.test.ts${mentionLast ? "" : " that times out on CI"}`,
    );
    expect(title?.children).toHaveLength(mentionLast ? 2 : 3);
    expect(title?.querySelector(".radar-pin-marker")).toBeNull();
  });

  it("wraps titles when twoLineTitles is true", () => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: { twoLineTitles: true },
    });
    expect(slot.container.querySelector(".radar-title-wrap")).not.toBeNull();
  });

  it.each([undefined, false, "1", "2", "invalid"])("keeps one-line titles when twoLineTitles is %s", (twoLineTitles) => {
    const slot = renderThreads([makeThread({ id: "t" })], {
      settings: twoLineTitles === undefined ? {} : { twoLineTitles },
    });
    expect(slot.container.querySelector(".radar-title-wrap")).toBeNull();
  });

  it("keeps quiet rows expanded when adaptive collapse is off", () => {
    const quiet = makeThread({
      id: "quiet",
      title: "Idle read thread",
      sectionId: "s1",
    });
    const sections = [makeSection({ id: "s1", name: "Backlog" })];

    // The subtitle line is what adaptive collapse folds away.
    const expanded = renderThreads([quiet], {
      settings: { adaptiveCollapse: false },
      sections,
    });
    expect(expanded.container.querySelector(".radar-row-subtitle")).toBeTruthy();
    cleanup();

    const folded = renderThreads([quiet], {
      settings: { adaptiveCollapse: true },
      sections,
    });
    const subtitle = folded.container.querySelector(".radar-row-subtitle");
    // Hidden rather than removed: the subtitle stays mounted.
    expect(
      subtitle?.closest(".radar-row-extra-collapsed") ??
        folded.container.querySelector(".radar-row-collapsed"),
    ).toBeTruthy();
  });
});

describe("folded row work", () => {
  it.each(["family", "group"])("mounts no rows, requests or gestures behind a saved %s fold", async (fold) => {
    const parentId = `${fold}-fold-parent`;
    const childId = `${fold}-fold-child`;
    localStorage.setItem(
      fold === "family" ? "radar-sidebar:collapsed-threads:v1" : "radar-sidebar:collapsed:v1",
      JSON.stringify([fold === "family" ? parentId : "time:today"]),
    );
    const fetch = vi.fn(async () => null);
    const added = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removed = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const slot = renderThreads([
      makeThread({ id: parentId }),
      makeThread({ id: childId, parentThreadId: parentId, status: "active", indicator: "runtime" }),
    ], { settings: { swipeActions: true }, sdk: { ...sdkFakes(), threads: { defaultExecutionOptions: fetch } } });
    const childRow = () => slot.container.querySelector(`[data-sidebar-thread-id="${childId}"]`)
      ?.closest<HTMLElement>(".radar-row") ?? null;
    const gestures = (spy: typeof added, row: HTMLElement) => spy.mock.calls.filter(([type], index) =>
      (type === "wheel" || type === "touchmove" || type === "click") && spy.mock.contexts[index] === row,
    );
    expect(childRow()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.focus(window);
    expect(fetch).not.toHaveBeenCalled();
    const toggle = (expand: boolean) => fireEvent.click(screen.getByRole("button", {
      name: fold === "family" ? expand ? "Expand replies" : "Collapse replies" : /Today,/,
    }));
    toggle(true);
    const child = childRow()!;
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith({ threadId: childId });
    expect(gestures(added, child)).toHaveLength(3);
    // Folding stops gestures at once, and drops the row once it has animated.
    toggle(false);
    expect(gestures(removed, child)).toHaveLength(3);
    expect(child.closest('[aria-hidden="true"]')).not.toBeNull();
    await waitFor(() => expect(childRow()).toBeNull());
    toggle(true);
    // A fold is a pause, not a restart: an unchanged run reuses its cache.
    expect(childRow()).not.toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    toggle(false);
    fireEvent.focus(window);
    expect(fetch).toHaveBeenCalledOnce();
    toggle(true);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("resumes a folded row when filtering reveals it, without changing saved folds", async () => {
    const key = "radar-sidebar:collapsed:v1";
    localStorage.setItem(key, JSON.stringify(["time:today"]));
    const fetch = vi.fn(async () => null);
    const slot = renderThreads([makeThread({
      id: "filter-reveals-live", title: "Needle", status: "active", indicator: "runtime",
    })], { sdk: { ...sdkFakes(), threads: { defaultExecutionOptions: fetch } } });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(slot.container.querySelector('[data-sidebar-thread-id="filter-reveals-live"]')!
      .closest('[aria-hidden="true"]')).toBeNull();
    expect(localStorage.getItem(key)).toBe(JSON.stringify(["time:today"]));
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    fireEvent.focus(window);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a pending hover preview when its ancestor folds", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const context = vi.fn(async () => ({ usage: null }));
    const slot = renderThreads([
      makeThread({ id: "hover-fold-parent" }),
      makeThread({ id: "hover-fold-child", parentThreadId: "hover-fold-parent" }),
    ], { sdk: { ...sdkFakes(), threads: { context } } });
    const child = slot.container.querySelector('[data-sidebar-thread-id="hover-fold-child"]')!
      .closest(".radar-row")!;
    fireEvent.pointerEnter(child, { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse replies" }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(context).not.toHaveBeenCalled();
  });

  it("keeps family summaries reactive while child rows stay unmounted", () => {
    localStorage.setItem("radar-sidebar:collapsed-threads:v1", JSON.stringify(["reactive-parent"]));
    const parent = makeThread({ id: "reactive-parent", latestAttentionAt: NOW });
    const child = makeThread({ id: "reactive-child", parentThreadId: parent.id, latestAttentionAt: NOW });
    const state: PluginSidebarThreadsState = {
      status: "ready", threads: [parent, child], projects: [makeProject({ id: "proj_a" })],
      sections: [], experimental_archived: null,
    };
    const snapshot = vi.spyOn(pluginSdk, "experimental_useSidebarThreads").mockReturnValue(state);
    const slot = renderThreads(state.threads as PluginSidebarThread[]);
    expect(slot.container.querySelector(".radar-kids-pill")).toBeNull();
    snapshot.mockReturnValue({ ...state, threads: [parent, {
      ...child, isUnread: true, indicator: "unread-error",
    }] });
    slot.rerender(createElement(threadList.component, {
      activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false,
      onNavigate: () => {}, searchQuery: "",
    }));
    const pill = slot.container.querySelector(".radar-kids-pill")!;
    expect(pill.textContent).toBe("1");
    expect(pill.querySelector(".radar-dot-error")).not.toBeNull();
    expect(slot.container.querySelector('[data-sidebar-thread-id="reactive-child"]')).toBeNull();
  });
});

describe("render cost", () => {
  // Every row asks for its jump shortcut exactly once per render.
  const renderedRowIds = (spy: { mock: { calls: unknown[][] } }) =>
    new Set(spy.mock.calls.map(([threadId]) => threadId));
  const props = {
    activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false,
    onNavigate: () => {}, searchQuery: "",
  };

  it("re-renders only the row whose thread changed when the host pushes a snapshot", () => {
    const threads = Array.from({ length: 12 }, (_, index) =>
      makeThread({ id: `snap-${index}`, latestAttentionAt: NOW - index * HOUR }));
    const state: PluginSidebarThreadsState = {
      status: "ready", threads, projects: [makeProject({ id: "proj_a" })],
      sections: [], experimental_archived: null,
    };
    const snapshot = vi.spyOn(pluginSdk, "experimental_useSidebarThreads").mockReturnValue(state);
    const rows = vi.spyOn(pluginSdk, "useSidebarThreadShortcut");
    const slot = renderSlot(threadList, props, { sdk: sdkFakes() });
    expect(renderedRowIds(rows).size).toBe(12);

    // The host hands over a new array on every update, even when only one
    // thread changed, and the list's derived order is rebuilt from it.
    rows.mockClear();
    const next = threads.slice();
    next[3] = { ...next[3]!, isUnread: true, indicator: "unread-success" };
    snapshot.mockReturnValue({ ...state, threads: next });
    slot.rerender(createElement(threadList.component, props));
    expect(renderedRowIds(rows)).toEqual(new Set(["snap-3"]));

    rows.mockClear();
    snapshot.mockReturnValue({ ...state, threads: next.slice() });
    slot.rerender(createElement(threadList.component, props));
    expect(rows).not.toHaveBeenCalled();
  });

  it("re-renders only rows whose time label moved on the minute tick", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    const rows = vi.spyOn(pluginSdk, "useSidebarThreadShortcut");
    renderThreads([
      makeThread({ id: "recent", latestAttentionAt: NOW - 5 * 60_000 }),
      makeThread({ id: "hours", latestAttentionAt: NOW - 3 * HOUR - 10 * 60_000 }),
      makeThread({ id: "days", latestAttentionAt: NOW - 3 * DAY }),
    ]);
    rows.mockClear();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(renderedRowIds(rows)).toEqual(new Set(["recent"]));
  });
});

describe("model and thinking display", () => {
  const execution = {
    model: "muse-spark",
    reasoningLevel: "high",
    permissionMode: "full",
    serviceTier: "default",
    source: "client/turn/start",
  };

  it("shows nothing for an idle thread that is not running", async () => {
    // The options endpoint resolves defaults, so it answers for every
    // thread; showing that on an idle one reads as fabricated.
    const idle = makeThread({ id: "idle", title: "Finished earlier" });
    const slot = renderThreads([idle], { execution });

    await waitFor(() => {
      expect(
        slot.container.querySelector(".radar-model-chip"),
      ).toBeNull();
    });
  });

  it("shows nothing on an idle branch thread last active yesterday", async () => {
    // The exact reported case: a worktree branch, read, idle, nothing due.
    const yesterday = makeThread({
      id: "y",
      title: "Yesterday branch thread",
      status: "idle",
      indicator: "none",
      isUnread: false,
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - DAY,
      latestAttentionAt: NOW - DAY,
      lastReadAt: NOW - DAY,
      environment: {
        id: "e",
        name: null,
        branchName: "codex/some-branch",
        path: "/tmp/x",
        isWorktree: true,
        providerId: "p",
        workspaceDisplayKind: null,
      },
    });
    const slot = renderThreads([yesterday], { execution });

    await waitFor(() =>
      expect(slot.container.querySelector(".radar-row")).toBeTruthy(),
    );

    expect(slot.container.querySelectorAll(".radar-model-chip")).toHaveLength(
      0,
    );
    // The branch line is deliberate and stays.
    expect(slot.container.querySelector(".radar-branch-line")).toBeTruthy();
  });

  it("shows model and thinking while the thread is running", async () => {
    const live = makeThread({
      id: "live",
      title: "Working now",
      status: "active",
      indicator: "runtime",
    });
    const slot = renderThreads([live], { execution });

    await waitFor(() => {
      expect(slot.container.querySelectorAll(".radar-model-chip").length)
        .toBeGreaterThan(0);
    });
    // No catalog entry in the stub, so the raw id is the documented fallback.
    expect(slot.container.textContent).toContain("muse-spark");
    expect(slot.container.textContent).toContain("High");
  });
});

describe("reconciliation", () => {
  it("renders multiple groups without React key warnings", async () => {
    // A group once lost its key when the section wrapper was introduced,
    // which React reports only as a console warning.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderThreads([
      makeThread({
        id: "a",
        title: "Today one",
        latestAttentionAt: NOW,
        projectId: "proj_a",
      }),
      makeThread({
        id: "b",
        title: "Old one",
        latestAttentionAt: NOW - 60 * DAY,
        projectId: "proj_b",
      }),
    ]);
    await waitFor(() =>
      expect(visibleRowIds(document.body as HTMLElement)).toEqual(["a", "b"]),
    );
    const keyWarnings = spy.mock.calls
      .map((call) => call.map(String).join(" "))
      .filter((text) => /unique.*key|Each child in a list/i.test(text));
    expect(keyWarnings).toEqual([]);
  });
});

describe("cyclic parents", () => {
  it("keeps threads whose parents point at each other visible", () => {
    const a = makeThread({ id: "a", parentThreadId: "b" });
    const b = makeThread({ id: "b", parentThreadId: "a" });
    const slot = renderThreads([a, b]);
    expect([...visibleRowIds(slot.container)].sort()).toEqual(["a", "b"]);
  });
});

describe("Pinned smart view", () => {
  it("filters the list to pinned threads", async () => {
    const pinned = makeThread({ id: "pin", isPinned: true, pinnedAt: NOW });
    const other = makeThread({ id: "other" });
    const slot = renderThreads([pinned, other]);
    expect(visibleRowIds(slot.container)).toContain("other");

    fireEvent.click(viewOptions().getByTitle("Pinned threads"));
    await waitFor(() =>
      expect(visibleRowIds(slot.container)).toEqual(["pin"]),
    );
  });

  it("hands over to a status filter instead of staying selected", async () => {
    renderThreads([makeThread({ id: "pin", isPinned: true, pinnedAt: NOW })]);
    fireEvent.click(viewOptions().getByTitle("Pinned threads"));
    fireEvent.click(viewOptions().getByTitle("Filter unread threads"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Clear Unread filter" })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Clear Pinned filter" })).toBeNull();
  });
});

describe("view options", () => {
  const dialog = () => screen.queryByRole("dialog", { name: "View options" });
  const button = () => screen.getByRole("button", { name: "View options" });

  it("keeps every list setting out of the header until asked", () => {
    renderThreads([makeThread({ id: "t" })]);
    expect(dialog()).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Status filter" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Thread lifecycle" })).toBeNull();

    fireEvent.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Status filter", "Thread lifecycle", "Grouping", "Row density"]) {
      expect(viewOptions().getByRole(name === "Status filter" ? "radiogroup" : "group", { name })).toBeTruthy();
    }
  });

  it("drops density on touch viewports, which are always compact", () => {
    renderThreads([makeThread({ id: "t" })], { isCompactViewport: true });
    expect(viewOptions().queryByRole("group", { name: "Row density" })).toBeNull();
    expect(viewOptions().getByRole("button", { name: "Collapse all folders" })).toBeTruthy();
  });

  it("stays open across changes and closes on Escape or an outside tap", () => {
    renderThreads([makeThread({ id: "t" })]);
    fireEvent.click(viewOptions().getByRole("button", { name: "Archived" }));
    fireEvent.click(viewOptions().getByRole("button", { name: "Group by project" }));
    expect(dialog()).not.toBeNull();

    fireEvent.keyDown(viewOptions().getByRole("button", { name: "Archived" }), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button());

    fireEvent.click(button());
    fireEvent.pointerDown(document.body);
    expect(dialog()).toBeNull();
  });

  it("shows a removable pill for each filter narrowing the list", async () => {
    const slot = renderThreads([
      makeThread({ id: "read", title: "Read" }),
      makeThread({ id: "unread", title: "Unread", isUnread: true }),
    ]);
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();

    fireEvent.click(viewOptions().getByTitle("Filter unread threads"));
    fireEvent.click(viewOptions().getByRole("button", { name: "All" }));
    fireEvent.keyDown(viewOptions().getByRole("button", { name: "All" }), { key: "Escape" });
    await waitFor(() => expect(visibleRowIds(slot.container)).toEqual(["unread"]));

    fireEvent.click(screen.getByRole("button", { name: "Clear Unread filter" }));
    await waitFor(() => expect(visibleRowIds(slot.container)).toContain("read"));
    expect(localStorage.getItem("radar-sidebar:status-filter:v1")).toBe("all");

    fireEvent.click(screen.getByRole("button", { name: "Clear Archived too filter" }));
    expect(localStorage.getItem("radar-sidebar:lifecycles:v1")).toBe("active");
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
  });
});

describe("keyboard shortcuts", () => {
  const archived = (slot: ReturnType<typeof renderThreads>) =>
    recordedActions(slot).filter(
      (call) => call.method === "archive",
    );

  it("only acts while focus is in the list or nowhere", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: "e" });
    expect(archived(slot)).toHaveLength(0);

    elsewhere.remove();
    fireEvent.keyDown(document.body, { key: "e" });
    expect(archived(slot)).toHaveLength(1);
  });

  it("still works when focus sits on plain page chrome", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    const pane = document.createElement("div");
    pane.tabIndex = -1;
    document.body.appendChild(pane);
    pane.focus();
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "e" });
    pane.remove();
    expect(archived(slot)).toHaveLength(1);
  });

  it("stays out of open dialogs and editable fields", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("div");
    inside.tabIndex = -1;
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    fireEvent.keyDown(inside, { key: "e" });

    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: "e" });

    dialog.remove();
    editor.remove();
    expect(archived(slot)).toHaveLength(0);
  });

  it("leaves keys another handler already consumed alone", () => {
    const slot = renderThreads([makeThread({ id: "t" })]);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const consumed = new KeyboardEvent("keydown", {
      key: "e",
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    document.body.dispatchEvent(consumed);
    expect(archived(slot)).toHaveLength(0);
  });

  it("does not swallow arrow keys when the list is empty", () => {
    renderThreads([]);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("review regressions", () => {
  it.each(["root", "child", "grandchild"])(
    "marks the entire family read from %s",
    async (targetId) => {
      const slot = renderThreads([
        makeThread({ id: "root" }),
        makeThread({ id: "child", parentThreadId: "root" }),
        makeThread({ id: "grandchild", parentThreadId: "child" }),
        makeThread({ id: "sibling", parentThreadId: "root" }),
      ]);
      fireEvent.contextMenu(
        slot.container.querySelector(`[data-sidebar-thread-id="${targetId}"]`)!,
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark family read" }));
      await waitFor(() => {
        const calls = slot.inspection.sdkCalls.filter(
          (call) => call.method === "threads.markRead",
        );
        expect(calls).toHaveLength(4);
        for (const threadId of ["root", "child", "grandchild", "sibling"]) {
          expect(calls).toContainEqual({
            method: "threads.markRead",
            args: [{ threadId }],
          });
        }
      });
    },
  );

  it("moves DOM focus and the highlight together on repeated arrow keys", () => {
    const slot = renderThreads(["a", "b", "c"].map((id) => makeThread({ id })));
    const row = (id: string) =>
      slot.container.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`)!;
    row("a").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("c"));
    expect(row("c").closest(".radar-row-keyboard-focused")).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("b"));
  });

  it("archives the highlighted row after navigating away from a focused link", () => {
    const slot = renderThreads(["a", "b"].map((id) => makeThread({ id })));
    slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="a"]')!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "e" });
    expect(recordedActions(slot)).toEqual([
      { method: "archive", threadId: "b" },
    ]);
  });

  it("keeps Space folding available after moving focus from the search field", () => {
    const slot = renderThreads([
      makeThread({ id: "parent" }),
      makeThread({ id: "child", parentThreadId: "parent" }),
    ]);
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const parent = slot.container.querySelector('[data-sidebar-thread-id="parent"]');
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(screen.getByRole("button", { name: "Expand replies" })).toBeTruthy();
  });

  it.each(["time", "project", "section", "pinned"])(
    "temporarily reveals filtered matches in collapsed %s groups",
    (grouping) => {
      localStorage.setItem("radar-sidebar:grouping:v1", grouping === "pinned" ? "time" : grouping);
      const slot = renderThreads([
        makeThread({ id: "needle", title: "Needle", isPinned: grouping === "pinned" }),
      ]);
      fireEvent.click(viewOptions().getByRole("button", { name: "Collapse all folders" }));
      const stored = localStorage.getItem("radar-sidebar:collapsed:v1");
      const row = () => slot.container.querySelector('[data-sidebar-thread-id="needle"]')!;
      expect(row().closest('[aria-hidden="true"]')).not.toBeNull();
      expect(shortcutTargetIds(slot.container)).toEqual([]);
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
      expect(row().closest('[aria-hidden="true"]')).toBeNull();
      expect(shortcutTargetIds(slot.container)).toEqual(["needle"]);
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(row());
      fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
      expect(row().closest('[aria-hidden="true"]')).not.toBeNull();
      expect(shortcutTargetIds(slot.container)).toEqual([]);
      expect(localStorage.getItem("radar-sidebar:collapsed:v1")).toBe(stored);
    },
  );

  it("reveals matches in collapsed groups for status filters too", () => {
    const slot = renderThreads([makeThread({ id: "unread", isUnread: true })]);
    fireEvent.click(viewOptions().getByRole("button", { name: "Collapse all folders" }));
    expect(shortcutTargetIds(slot.container)).toEqual([]);
    fireEvent.click(viewOptions().getByTitle("Filter unread threads"));
    expect(shortcutTargetIds(slot.container)).toEqual(["unread"]);
    expect(
      slot.container.querySelector('[data-sidebar-thread-id="unread"]')!
        .closest('[aria-hidden="true"]'),
    ).toBeNull();
  });

  it("keeps empty sections available as drop targets", () => {
    renderThreads([makeThread({ id: "unfiled" })], {
      sections: [makeSection({ id: "empty", name: "Empty bucket" })],
    });
    fireEvent.click(viewOptions().getByRole("button", {
      name: "Group by section (drag threads between them)",
    }));
    expect(screen.getByRole("region", { name: "Empty bucket" })).toBeTruthy();
    expect(screen.getByText("Drop a thread here to file it.")).toBeTruthy();
  });

  it("keeps archived pagination available when loaded rows do not match", () => {
    localStorage.setItem("radar-sidebar:lifecycles:v1", "archived");
    const fetchNextPage = vi.fn(async () => {});
    renderThreads([makeThread({ id: "one", title: "Unrelated", isArchived: true })], {
      archived: {
        status: "ready",
        hasNextPage: true,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage,
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
    expect(screen.getByText(/No threads match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});

describe("section creation", () => {
  const sectionMode = () => fireEvent.click(viewOptions().getByRole("button", {
    name: "Group by section (drag threads between them)",
  }));
  const openForm = () => {
    sectionMode();
    fireEvent.click(screen.getByRole("button", { name: "New section" }));
    return screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement;
  };
  const createSdk = (create: (args: { name: string }) => Promise<unknown>) => ({
    ...sdkFakes(),
    threadSections: { create },
  });

  it("creates a trimmed section through the SDK, even before there are threads", async () => {
    const create = vi.fn(async ({ name }: { name: string }) => makeSection({ id: "new", name }));
    const slot = renderThreads([], { sdk: createSdk(create) });
    expect(screen.queryByRole("button", { name: "New section" })).toBeNull();
    const input = openForm();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  Research  " } });
    fireEvent.submit(screen.getByRole("form", { name: "New section" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull());
    expect(slot.inspection.sdkCalls).toContainEqual({
      method: "threadSections.create", args: [{ name: "Research" }],
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New section" }));
  });

  it("rejects blank names and cancels without creating or firing row shortcuts", () => {
    const create = vi.fn();
    const slot = renderThreads([makeThread({ id: "one" })], { sdk: createSdk(create) });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    const input = openForm();
    fireEvent.change(input, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Create section" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "New section" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(cancel, { key: "e" });
    fireEvent.keyDown(cancel, { key: "p" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "New section" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New section" }));
    fireEvent.click(screen.getByRole("button", { name: "New section" }));
    expect((screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(create).not.toHaveBeenCalled();
    expect(recordedActions(slot)).toEqual([]);
  });

  it("keeps a failed name for retry and shows the API error", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("Could not create section"))
      .mockResolvedValueOnce(makeSection({ id: "new", name: "Research" }));
    renderThreads([], { sdk: createSdk(create) });
    const input = openForm();
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not create section");
    expect(input.value).toBe("Research");
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole("button", { name: "Create section" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "New section" })).toBeNull());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate submissions while creation is pending", async () => {
    let resolve!: (section: ReturnType<typeof makeSection>) => void;
    const create = vi.fn(() => new Promise<ReturnType<typeof makeSection>>((done) => { resolve = done; }));
    renderThreads([], { sdk: createSdk(create) });
    const input = openForm();
    fireEvent.change(input, { target: { value: "Research" } });
    const form = screen.getByRole("form", { name: "New section" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledOnce();
    expect(input.disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(form, { key: "Escape" });
    expect(screen.getByRole("form", { name: "New section" })).toBe(form);
    await act(async () => resolve(makeSection({ id: "new", name: "Research" })));
    expect(screen.queryByRole("form", { name: "New section" })).toBeNull();
  });

  it.each([false, true])("shows empty sections from the host with no matching threads (filter=%s)", (filtered) => {
    renderThreads(filtered ? [makeThread({ id: "one" })] : [], {
      sections: [makeSection({ id: "new", name: "Research" })],
    });
    sectionMode();
    if (filtered) fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no match" } });
    expect(screen.getByRole("region", { name: "Research" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New section" })).toBeTruthy();
  });
});

describe("selection", () => {
  it("drops selected threads that a filter hides", async () => {
    const read = makeThread({ id: "read", latestAttentionAt: NOW });
    const unread = makeThread({
      id: "unread",
      isUnread: true,
      indicator: "unread-success",
      latestAttentionAt: NOW - 2 * HOUR,
    });
    const slot = renderThreads([read, unread]);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "x" });
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(viewOptions().getByTitle("Filter unread threads"));
    await waitFor(() =>
      expect(visibleRowIds(slot.container)).toEqual(["unread"]),
    );
    expect(screen.queryByText("1 selected")).toBeNull();
  });
});

describe("state colors and stable rows", () => {
  afterEach(() => { vi.useRealTimers(); });
  const props = {
    activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false,
    onNavigate: () => {}, searchQuery: "",
  };
  const row = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-sidebar-thread-id="${id}"]`)!.closest(".radar-row")!;

  it("draws running work in blue, with only the icon moving", () => {
    const slot = renderThreads([
      makeThread({ id: "run", status: "active", indicator: "runtime" }),
      makeThread({ id: "agent", activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 }, indicator: "background-agent" }),
    ]);
    const run = row(slot.container, "run");
    expect(run.querySelector(".radar-spinner")?.className).toContain("radar-tone-running");
    expect(within(run as HTMLElement).getByText("Working").className).toContain("radar-tone-running");
    const icon = row(slot.container, "agent").querySelector(".radar-status-icon")!;
    expect(icon.className).toContain("radar-tone-running");
    expect(icon.className).toContain("radar-icon-pulse");
    expect(slot.container.querySelector(".radar-row-badges .radar-tone-success")).toBeNull();
  });

  it("shows a done row's unread state once, without a wash", () => {
    const slot = renderThreads([
      makeThread({ id: "done", isUnread: true, indicator: "unread-success" }),
      makeThread({ id: "plain", isUnread: true }),
    ]);
    const done = row(slot.container, "done");
    expect(done.querySelector(".radar-status-icon.radar-tone-success")).not.toBeNull();
    expect(done.querySelector(".radar-unread")).toBeNull();
    expect(done.className).toContain("radar-row-unread");
    expect(done.className).not.toMatch(/radar-row-(needs-user|failed|pulse)/);
    expect(row(slot.container, "plain").querySelector(".radar-unread")).not.toBeNull();
  });

  it("keeps queued rows muted and still", () => {
    const slot = renderThreads([makeThread({ id: "queued", status: "active", queuedWork: "waiting", indicator: "queued-waiting" })]);
    const queued = row(slot.container, "queued");
    expect(queued.className).not.toContain("radar-row-pulse");
    expect(queued.querySelector(".radar-status-icon")?.className).toContain("radar-tone-muted");
    expect(within(queued as HTMLElement).getByText("Queued").className).toContain("radar-tone-muted");
  });

  it("shows a message parked on an idle thread as held, outside the Working drawer", () => {
    const slot = renderThreads([
      makeThread({ id: "held", title: "Parked", queuedWork: "waiting", indicator: "queued-waiting", indicatorLabel: "Message queued" }),
      makeThread({ id: "run", status: "active", indicator: "runtime" }),
    ], { settings: { hideWorking: true } });
    const held = row(slot.container, "held");
    expect(held.closest(".radar-working-drawer")).toBeNull();
    expect(screen.getByRole("button", { name: "Working, 1 thread" })).toBeTruthy();
    expect(held.className).not.toMatch(/radar-row-(pulse|needs-user|failed)/);
    expect(held.querySelector(".radar-status-icon")?.className).toContain("radar-tone-muted");
    expect(held.querySelector("[data-icon=\"Pause\"]")).not.toBeNull();
    expect(within(held as HTMLElement).getByText("Held").className).toContain("radar-tone-muted");
    expect(within(held as HTMLElement).queryByText("Queued")).toBeNull();
    expect(held.querySelector(".radar-row-status-badge")?.getAttribute("title")).toBe("Message held until you send it");
    expect(held.querySelector("[data-sidebar-thread-id]")?.getAttribute("aria-label")).toContain("Message held until you send it");
  });

  it("decides a row's fold once, so reading or finishing never changes its height", () => {
    const threads = [makeThread({ id: "quiet" }), makeThread({ id: "busy", isUnread: true, indicator: "unread-success" })];
    const state: PluginSidebarThreadsState = {
      status: "ready", threads, projects: [makeProject({ id: "proj_a" })], sections: [], experimental_archived: null,
    };
    const snapshot = vi.spyOn(pluginSdk, "experimental_useSidebarThreads").mockReturnValue(state);
    const slot = renderSlot(threadList, props, { sdk: sdkFakes(), settings: { adaptiveCollapse: true } });
    expect(row(slot.container, "quiet").className).toContain("radar-row-collapsed");
    expect(row(slot.container, "busy").className).not.toContain("radar-row-collapsed");
    snapshot.mockReturnValue({ ...state, threads: [
      { ...threads[0]!, isUnread: true, indicator: "unread-success" },
      { ...threads[1]!, isUnread: false, indicator: "none" },
    ] });
    slot.rerender(createElement(threadList.component, props));
    expect(row(slot.container, "quiet").className).toContain("radar-row-collapsed");
    expect(row(slot.container, "busy").className).not.toContain("radar-row-collapsed");
  });

  it("holds row order while the pointer is over the list", () => {
    const threads = [
      makeThread({ id: "first", latestAttentionAt: NOW - HOUR }),
      makeThread({ id: "second", latestAttentionAt: NOW - 2 * HOUR }),
    ];
    const state: PluginSidebarThreadsState = {
      status: "ready", threads, projects: [makeProject({ id: "proj_a" })], sections: [], experimental_archived: null,
    };
    const snapshot = vi.spyOn(pluginSdk, "experimental_useSidebarThreads").mockReturnValue(state);
    const slot = renderSlot(threadList, props, { sdk: sdkFakes() });
    expect(visibleRowIds(slot.container)).toEqual(["first", "second"]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerEnter(slot.container.querySelector(".radar-list")!, { pointerType: "mouse" });
    snapshot.mockReturnValue({ ...state, threads: [threads[0]!, { ...threads[1]!, latestAttentionAt: NOW - 1000, isUnread: true }] });
    slot.rerender(createElement(threadList.component, props));
    expect(visibleRowIds(slot.container)).toEqual(["first", "second"]);
    expect(row(slot.container, "second").className).toContain("radar-row-unread");
    fireEvent.pointerLeave(slot.container.querySelector(".radar-list")!, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(450); });
    expect(visibleRowIds(slot.container)).toEqual(["second", "first"]);
  });
});

describe("chips, titles and headers", () => {
  it("keeps every project and section chip hue out of the red-to-amber band", async () => {
    const { projectHue, CHIP_HUE_MIN, CHIP_HUE_MAX } = await import("./RadarThreadRow");
    expect([CHIP_HUE_MIN, CHIP_HUE_MAX]).toEqual([75, 325]);
    const ids = ["edgerouter", "ERBareeq", "bb", "bricks-tickets", "t2c", "proj_a", "",
      ...Array.from({ length: 5000 }, (_, i) => `proj_${i.toString(36)}`),
      ...Array.from({ length: 2000 }, (_, i) => `section:sec_${i}`)];
    for (const id of ids) {
      const hue = projectHue(id);
      expect(hue).toBeGreaterThanOrEqual(75);
      expect(hue).toBeLessThanOrEqual(325);
    }
    expect(projectHue("edgerouter")).toBe(projectHue("edgerouter"));
  });

  it("drops one leading status emoji from the shown title only", () => {
    const slot = renderThreads([
      makeThread({ id: "emoji", title: "🟢 Redemption #116" }),
      makeThread({ id: "plain", title: "Plain #1 title" }),
      makeThread({ id: "middle", title: "Fix 🟢 middle" }),
    ]);
    const link = (id: string) => slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`)!;
    const shown = (id: string) => link(id).querySelector(".radar-thread-title")!.textContent;
    expect(shown("emoji")).toBe("Redemption #116");
    // Tooltip and accessible name keep the full title.
    expect(link("emoji").getAttribute("title")).toBe("🟢 Redemption #116");
    expect(link("emoji").getAttribute("aria-label")).toContain("🟢 Redemption #116");
    // Untouched titles stay with bb's ThreadTitle, which draws mention chips.
    expect(link("emoji").querySelector("[data-thread-title]")).toBeNull();
    expect(link("plain").querySelector("[data-thread-title]")).not.toBeNull();
    expect(link("middle").querySelector("[data-thread-title]")).not.toBeNull();
  });

  it("does not rename on double-click", () => {
    const slot = renderThreads([makeThread({ id: "t", title: "Keep" })]);
    fireEvent.doubleClick(slot.container.querySelector('[data-sidebar-thread-id="t"]')!);
    expect(screen.queryByRole("textbox", { name: "Rename thread" })).toBeNull();
  });

  it("shows unread group counts as words beside the total", () => {
    const slot = renderThreads([
      makeThread({ id: "a", isUnread: true, indicator: "unread-success" }),
      makeThread({ id: "b" }),
    ]);
    const toggle = screen.getByRole("button", { name: /, 1 unread of 2$/ });
    expect(toggle.querySelector(".radar-group-meta")?.textContent).toBe("1 unread · 2");
    expect(toggle.querySelector(".radar-group-meta .radar-unread")).toBeNull();
    cleanup();
    renderThreads([makeThread({ id: "c" })]);
    expect(screen.getByRole("button", { name: /, 1 thread$/ }).querySelector(".radar-group-meta")?.textContent).toBe("1");
    void slot;
  });
});
