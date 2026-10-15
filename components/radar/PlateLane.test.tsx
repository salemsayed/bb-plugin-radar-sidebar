import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PlateLane, DONE_TODAY_MAX } from "./PlateLane";
import { plateItemSchema, type PlateItem, type PlateMode } from "@/lib/plate";
import { NEEDS_BOT, NEEDS_NOW } from "./needsFixtures";
import { makeThread } from "./fixtures";
import type { RosterBot } from "./bots";

const app = await loadPluginApp(() => import("../../app"));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const WORK_BOT: RosterBot = { ...NEEDS_BOT, key: "work", name: "Work Bot", current: "work-coord", coordinatorIds: [] };
const ROSTER = [NEEDS_BOT, WORK_BOT];
function makePlate(overrides: Partial<PlateItem> = {}): PlateItem {
  return plateItemSchema.parse({ id: "pl_1", bot: "home", text: "Fix the camera", via: "salem", sourceThread: "coord", sourceSeq: 4, state: "open",
    owner: null, workerThread: null, workerTitle: null, lastWord: null, relay: null, followUps: 0,
    progressAt: "2026-10-07T07:00:00.000Z", createdAt: "2026-10-06T07:00:00.000Z", closedAt: null, evidence: null, nudgedAt: null, askedAt: null, ...overrides });
}
function mount(items: PlateItem[], { modes = { home: "on", work: "on" } as Record<string, PlateMode>, bot = null as string | null } = {}) {
  const update = vi.fn(async () => {}), open = vi.fn();
  return { update, open, ...render(<PlateLane items={items} modes={modes} roster={ROSTER} now={NEEDS_NOW} bot={bot} open onToggle={() => {}} onUpdate={update} onOpen={open} />) };
}
const rowTexts = (root: HTMLElement) => Array.from(root.querySelectorAll(".radar-plate-text")).map(node => node.textContent);

describe("the Plate lane", () => {
  it("counts per bot and orders rows stalled, waiting, running, open", () => {
    mount([
      makePlate({ id: "o", text: "Open one" }),
      makePlate({ id: "r", text: "Running one", state: "running", workerThread: "w1", workerTitle: "Camera worker", lastWord: "x".repeat(120) }),
      makePlate({ id: "w", text: "Waiting one", state: "waiting", owner: "salem" }),
      makePlate({ id: "y", text: "Waiting on Yasser", state: "waiting", owner: "Yasser", progressAt: "2026-10-05T07:00:00.000Z" }),
      makePlate({ id: "s", text: "Stalled one", state: "stalled" }),
    ]);
    expect(screen.getByRole("button", { name: /^Plate/ }).textContent).toBe("Plate · 5");
    const section = screen.getByRole("region", { name: "Home plate" });
    expect(within(section).getByRole("button", { name: /^Home/ }).textContent).toBe("Home · 5 in flight · 1 on you · 1 stalled");
    expect(rowTexts(section)).toEqual(["“Stalled one”", "“Waiting on Yasser”", "“Waiting one”", "“Running one”", "“Open one”"]);
    const meta = Array.from(section.querySelectorAll(".radar-plate-meta")).map(node => Array.from(node.children).map(part => part.textContent));
    expect(meta[1]).toEqual(["2 d", "on Yasser"]);
    expect(meta[2]).toEqual(["3 h", "on you"]);
    expect(meta[3]).toEqual(["3 h", "Camera worker", `${"x".repeat(79)}…`]);
    expect(screen.queryByRole("region", { name: "Work plate" })).toBeNull();
  });
  it("shows only today's done rows in Cairo, at most eight, folded under Done today", () => {
    const done = Array.from({ length: 10 }, (_, i) => makePlate({ id: `d${i}`, text: `Done ${i}`, state: "done", closedAt: `2026-10-07T0${i % 10}:00:00.000Z` }));
    mount([makePlate(), ...done,
      makePlate({ id: "late", text: "After midnight Cairo", state: "done", closedAt: "2026-10-06T22:30:00.000Z" }),
      makePlate({ id: "old", text: "Yesterday", state: "done", closedAt: "2026-10-06T10:00:00.000Z" }),
      makePlate({ id: "drop", text: "Dropped", state: "dropped", closedAt: "2026-10-07T09:00:00.000Z" })]);
    const section = screen.getByRole("region", { name: "Home plate" });
    expect(rowTexts(section)).toEqual(["“Fix the camera”"]);
    fireEvent.click(within(section).getByRole("button", { name: /^Done today/ }));
    expect(within(section).getByRole("button", { name: /^Done today/ }).textContent).toBe(`Done today · ${DONE_TODAY_MAX}`);
    const list = within(section).getByRole("list", { name: "Home done today" });
    expect(rowTexts(list)).toEqual(["“Done 9”", "“Done 8”", "“Done 7”", "“Done 6”", "“Done 5”", "“Done 4”", "“Done 3”", "“Done 2”"]);
    expect(screen.queryByText("“Yesterday”")).toBeNull(); expect(screen.queryByText("“Dropped”")).toBeNull();
  });
  it("expands on first tap, opens worker and chat, and Done asks for evidence before saving", async () => {
    const h = mount([makePlate({ state: "running", workerThread: "hidden-worker", workerTitle: "Camera worker", lastWord: "Firmware flashed, rebooting", evidence: null })]);
    expect(screen.queryByRole("button", { name: "Drop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "“Fix the camera”" }));
    fireEvent.click(screen.getByRole("button", { name: "Open worker" })); expect(h.open).toHaveBeenLastCalledWith("hidden-worker");
    fireEvent.click(screen.getByRole("button", { name: "Open chat" })); expect(h.open).toHaveBeenLastCalledWith("coord");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "What shows it is done?" }), { target: { value: "Camera back online" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("pl_1", "done", "Camera back online"));
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith("pl_1", "drop", undefined));
  });
  it("shows only the bot's own section in its view, and only bots whose plate is on", () => {
    const items = [makePlate(), makePlate({ id: "pl_2", bot: "work", text: "Send the invoice" })];
    mount(items, { bot: "work" });
    expect(screen.queryByRole("region", { name: "Home plate" })).toBeNull();
    expect(screen.getByRole("region", { name: "Work plate" })).toBeTruthy();
    cleanup();
    mount(items, { modes: { home: "on", work: "shadow" } });
    expect(screen.getByRole("button", { name: /^Plate/ }).textContent).toBe("Plate · 1");
    expect(screen.queryByRole("region", { name: "Work plate" })).toBeNull();
  });
  it("is not rendered with nothing on the plate or every plate off", () => {
    mount([]); expect(screen.queryByRole("region", { name: "Plate" })).toBeNull(); cleanup();
    mount([makePlate()], { modes: { home: "off", work: "shadow" } }); expect(screen.queryByRole("region", { name: "Plate" })).toBeNull();
  });
});

describe("the sidebar's Plate lane", () => {
  function renderList(items: PlateItem[], settings: Record<string, boolean> = {}) {
    const sdk: Record<string, unknown> = {
      threads: { defaultExecutionOptions: async () => null, context: async () => ({ usage: null }), output: async () => ({ output: null }) },
      providers: { models: async () => ({ models: [] }) },
      system: { uiPreferences: { list: async () => ({ preferences: {} }), set: async () => ({ revision: 1, value: [] }) } },
      plugins: { callRpc: async () => ({ bots: [NEEDS_BOT] }) },
    };
    return renderSlot(app.threadLists[0]!, { activeThreadId: null, activeProjectId: "p", isCompactViewport: false, onNavigate: () => {}, searchQuery: "" }, {
      sdk, settings, rpc: {
        crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }),
        crew_plate_list: () => ({ items, modes: { home: "on" } }),
        crew_plate_update: (input: unknown) => { const { id, action } = input as { id: string; action: string }; return { item: { ...items.find(item => item.id === id)!, state: action === "drop" ? "dropped" : "done", closedAt: "2026-10-07T09:00:00.000Z" } }; },
      },
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "coord" })], projects: [], sections: [], experimental_archived: null },
    });
  }
  it("folds into one counted row, drops a row through crew_plate_update and reads the plate again", async () => {
    const host = renderList([makePlate({ workerThread: "hidden-worker" })]);
    const fold = await screen.findByRole("button", { name: /^Plate/ });
    expect(fold.textContent).toBe("Plate · 1");
    expect(host.inspection.rpcCalls.find(call => call.method === "crew_plate_list")?.input).toEqual({ states: ["open", "running", "waiting", "stalled", "done"] });
    fireEvent.click(fold);
    fireEvent.click(await screen.findByRole("button", { name: "“Fix the camera”" }));
    fireEvent.click(screen.getByRole("button", { name: "Open worker" }));
    expect(host.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "hidden-worker" });
    const reads = host.inspection.rpcCalls.filter(call => call.method === "crew_plate_list").length;
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    await waitFor(() => expect(host.inspection.rpcCalls.find(call => call.method === "crew_plate_update")?.input).toEqual({ id: "pl_1", action: "drop" }));
    await waitFor(() => expect(host.inspection.rpcCalls.filter(call => call.method === "crew_plate_list").length).toBeGreaterThan(reads));
  });
  it("stays off with the lane setting", async () => {
    const host = renderList([makePlate()], { plateLane: false });
    await waitFor(() => expect(host.inspection.rpcCalls.some(call => call.method === "crew_needs_list")).toBe(true));
    expect(screen.queryByRole("region", { name: "Plate" })).toBeNull();
    expect(host.inspection.rpcCalls.some(call => call.method === "crew_plate_list")).toBe(false);
  });
});
