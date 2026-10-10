import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { NeedsYouList } from "./NeedsYouList";
import { useNeedsYou } from "./useCrewData";
import { NEEDS_BOT, NEEDS_NOW, makeNeed } from "./needsFixtures";
import { makeThread } from "./fixtures";

const app = await loadPluginApp(() => import("../../app"));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(items = [makeNeed()]) {
  const update = vi.fn(async () => {}), open = vi.fn();
  return { update, open, ...render(<NeedsYouList items={items} roster={[NEEDS_BOT]} now={NEEDS_NOW} onUpdate={update} onOpen={open} />) };
}

it("renders full asks in due order with bot labels and expandable snoozed reminders", async () => {
  mount([makeNeed({ id: "late", text: "Later", due: "2026-10-15", kind: "deadline" }), makeNeed({ id: "now", text: "Now", due: "2026-10-07", kind: "urgent" }), makeNeed({ id: "none", text: "No date", due: null }), makeNeed({ id: "hidden", state: "snoozed", text: "Snoozed reminder", snoozeUntil: "2026-10-08T06:00Z" }), makeNeed({ id: "done", state: "done", text: "Done item" })]);
  expect(screen.getAllByRole("listitem").map(row => row.querySelector(".radar-needs-text")?.textContent)).toEqual(["Now", "Later", "No date"]);
  expect(screen.getByText("Due today")).toBeTruthy(); expect(screen.getByText("Due 15 Oct")).toBeTruthy();
  expect(screen.getAllByText("Home")).toHaveLength(3);
  expect(screen.queryByText("Snoozed reminder")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /1 snoozed/ }));
  expect(screen.getByText("Snoozed until 8 Oct, 09:00 Cairo")).toBeTruthy();
  expect(screen.getByText("Snoozed reminder").getAttribute("title")).toBeNull();
  expect(screen.getByRole("heading", { name: "Needs you 3 · 1 snoozed" })).toBeTruthy();
  if (process.env.RADAR_QA_DIR) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${process.env.RADAR_QA_DIR}/needs.html`, screen.getByRole("region", { name: "Needs you" }).outerHTML);
  }
});

it("shows an unavailable saved-decisions service honestly and recovers through Retry", async () => {
  let available = false;
  const sdk = { plugins: { callRpc: async <T,>({ pluginId }: { pluginId: string }) => (pluginId === "chatgpt-events" ? { connected: false } : { bots: [NEEDS_BOT] }) as T } };
  renderSlot(app.navPanels.find(panel => panel.id === "crew")!, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: available ? [] : null }) }, sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: NEEDS_BOT.current })] } });
  expect(await screen.findByText("Saved questions are unavailable.")).toBeTruthy();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
  available = true;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Nothing needs you.")).toBeTruthy();
});
it("offers Done, all Snooze times, native date/time, and Open without hover", async () => {
  const host = mount();
  fireEvent.click(screen.getByRole("button", { name: /^Open:/ }));
  expect(host.open).toHaveBeenCalledWith("coord");
  fireEvent.click(screen.getByRole("button", { name: /^Snooze:/ }));
  expect(screen.getByRole("button", { name: "Later today · 18:00" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Monday · 09:00" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tomorrow · 09:00" }));
  await waitFor(() => expect(host.update).toHaveBeenCalledWith("need1", "snooze", "2026-10-08T06:00:00.000Z"));
  fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ }));
  await waitFor(() => expect(host.update).toHaveBeenCalledWith("need1", "done", undefined));
});
it("keeps failed changes visible and reports a retryable error", async () => {
  const host = mount(); host.update.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Approve the repair")).toBeTruthy();
});
it("reuses touch swipe for Done and Snooze", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  const host = mount();
  const row = host.container.querySelector(".radar-needs-row")!;
  fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 250, clientY: 100 }] });
  fireEvent.touchEnd(row, { touches: [] });
  await waitFor(() => expect(host.update).toHaveBeenCalledWith("need1", "done", undefined));
  const undo = await screen.findByRole("button", { name: "Undo" });
  // Flush the restored row's effects before sending a second gesture.
  await act(async () => { fireEvent.click(undo); });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Snooze:/ }).hasAttribute("disabled")).toBe(false));
  const restored = host.container.querySelector(".radar-needs-row")!;
  fireEvent.touchStart(restored, { touches: [{ clientX: 250, clientY: 100 }] });
  fireEvent.touchMove(restored, { touches: [{ clientX: 230, clientY: 100 }] });
  fireEvent.touchMove(restored, { touches: [{ clientX: 90, clientY: 100 }] });
  fireEvent.touchEnd(restored, { touches: [] });
  expect(await screen.findByRole("button", { name: "Tomorrow · 09:00" })).toBeTruthy();
});

describe("needs hook/server bridge", () => {
  function component() { const needs = useNeedsYou(); return <NeedsYouList items={needs.items} roster={[NEEDS_BOT]} now={NEEDS_NOW} onUpdate={needs.update} onOpen={() => {}} />; }
  const slot = { ...app.threadPanelActions[0]!, component };
  it("hides quietly when the RPC is unavailable", async () => {
    const host = renderSlot(slot, { threadId: "coord", params: null });
    await waitFor(() => expect(host.inspection.rpcCalls.some(call => call.method === "crew_needs_list")).toBe(true));
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
  });
  it("refreshes after actions and at the short interval", async () => {
    vi.useFakeTimers();
    let items = [makeNeed()];
    const load = vi.fn(() => ({ items }));
    renderSlot(slot, { threadId: "coord", params: null }, { rpc: {
      crew_needs_list: load,
      crew_needs_update: () => { items = []; return { item: makeNeed({ state: "done" }) }; },
    } });
    await act(async () => {});
    expect(screen.getByText("Approve the repair")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ })); });
    expect(screen.queryByText("Approve the repair")).toBeNull();
    const calls = load.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(load.mock.calls.length).toBeGreaterThan(calls);
  });
  it("renders Needs you on the Crew page and opens the source thread", async () => {
    const host = renderSlot(app.navPanels.find(panel => panel.id === "crew")!, { subPath: "" }, {
      rpc: { crew_needs_list: () => ({ items: [makeNeed()] }) },
    });
    const region = await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(within(region).getByRole("button", { name: /^Open:/ }));
    expect(host.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "coord" });
  });
});

it("offers six-second Undo after Done, reopens the item, and expires when dismissed", async () => {
  vi.useFakeTimers();
  let items = [makeNeed()];
  function component() { const needs = useNeedsYou(); return <NeedsYouList items={needs.items} roster={[NEEDS_BOT]} now={NEEDS_NOW} onUpdate={needs.update} onOpen={() => {}} />; }
  const update = vi.fn((input: { action: string }) => {
    const item = makeNeed({ state: input.action === "reopen" ? "open" : "done" });
    items = item.state === "open" ? [item] : [];
    return { item };
  });
  renderSlot({ ...app.threadPanelActions[0]!, component }, { threadId: "coord", params: null }, { rpc: { crew_needs_list: () => ({ items }), crew_needs_update: input => update(input as { action: string }) } });
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ })); });
  expect(screen.queryByText("Approve the repair")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
  expect(update).toHaveBeenLastCalledWith({ id: "need1", action: "reopen" });
  expect(screen.getByText("Approve the repair")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ })); });
  await act(async () => { vi.advanceTimersByTime(5_999); });
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
it("shares one needs request/interval between the sidebar digest and the list", async () => {
  vi.useFakeTimers();
  const load = vi.fn(() => ({ items: [makeNeed()] }));
  function component() {
    const needs = useNeedsYou();
    return <><output>{needs.items?.length ?? 0} sidebar items</output><NeedsYouList items={needs.items} roster={[NEEDS_BOT]} now={NEEDS_NOW} onUpdate={needs.update} onOpen={() => {}} /></>;
  }
  renderSlot({ ...app.threadPanelActions[0]!, component }, { threadId: "coord", params: null }, { rpc: { crew_needs_list: load } });
  await act(async () => {});
  expect(screen.getByText("1 sidebar items")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Needs you" })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(load).toHaveBeenCalledTimes(2);
});

it("preserves separate in-place Undo for two quickly completed asks", async () => {
  vi.useFakeTimers();
  const host = mount([makeNeed({ id: "first", text: "First ask" }), makeNeed({ id: "second", text: "Second ask" })]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark done: First ask" })); });
  await act(async () => { vi.advanceTimersByTime(2_000); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark done: Second ask" })); });
  expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
  await act(async () => { vi.advanceTimersByTime(4_000); });
  expect(screen.queryByText("Done: First ask")).toBeNull();
  expect(screen.getByText("Done: Second ask")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
  expect(host.update).toHaveBeenLastCalledWith("second", "reopen");
});

it("keeps a failed Undo available after six seconds and retries it", async () => {
  vi.useFakeTimers();
  const host = mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ })); });
  host.update.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
  expect(screen.getByRole("alert").textContent).toContain("Couldn’t undo");
  await act(async () => { vi.advanceTimersByTime(10_000); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
  expect(host.update).toHaveBeenLastCalledWith("need1", "reopen");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retries the actual failed operation and leaves source-free reminders readable", async () => {
  const host = mount([makeNeed({ source: {}, kind: "reminder" })]);
  expect(screen.queryByRole("button", { name: /^Open:/ })).toBeNull();
  expect(screen.getByText("Approve the repair")).toBeTruthy();
  host.update.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: /^Mark done:/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
  expect(host.update.mock.calls).toEqual([["need1", "done", undefined], ["need1", "done", undefined]]);
});

it("renders the chosen A ask hierarchy with realistic long and snoozed data", async () => {
  const bricks = { ...NEEDS_BOT, key: "bricks", name: "Bricks Bot" };
  const personal = { ...NEEDS_BOT, key: "personal", name: "Personal Bot" };
  const items = [
    makeNeed({ id: "meter", text: "I need the current Mum apt meter balance when you have it.", due: null }),
    makeNeed({ id: "pilot", bot: "bricks", text: "Start the products-only pilot now?", due: null }),
    makeNeed({ id: "worker", bot: "bricks", text: "Want me to spawn that v2 planning worker alongside the pilot?", due: null }),
    makeNeed({ id: "payment", bot: "personal", kind: "deadline", text: "Pay Hana’s 3rd Voltaire installment: 47,645 EGP (school finance, Fawry or bank transfer; not InstaPay)", due: "2026-10-15", source: {} }),
    makeNeed({ id: "snoozed", text: "Send the reading tomorrow", state: "snoozed", snoozeUntil: "2026-10-08T06:00Z", due: null }),
  ];
  const update = vi.fn(async () => {});
  const host = render(<NeedsYouList items={items} roster={[NEEDS_BOT, bricks, personal]} now={NEEDS_NOW} onUpdate={update} onOpen={() => {}} />);
  expect(screen.getAllByRole("button", { name: /^Mark done:/ })).toHaveLength(4);
  expect(screen.getAllByRole("button", { name: /^Snooze:/ })).toHaveLength(4);
  expect(screen.getAllByRole("button", { name: /^Open:/ })).toHaveLength(3);
  if (process.env.RADAR_QA_DIR) {
    const { writeFile } = await import("node:fs/promises");
    const save = async (name: string) => writeFile(`${process.env.RADAR_QA_DIR}/${name}.html`, host.container.innerHTML);
    await save("asks-a");
    fireEvent.click(screen.getByRole("button", { name: /1 snoozed/ }));
    await save("asks-snoozed");
    fireEvent.click(screen.getByRole("button", { name: "Mark done: Start the products-only pilot now?" }));
    await screen.findByRole("button", { name: "Undo" });
    await save("asks-undo");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByRole("button", { name: "Mark done: Start the products-only pilot now?" });
    update.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Mark done: Start the products-only pilot now?" }));
    await screen.findByRole("button", { name: "Retry" });
    await save("asks-error");
    fireEvent.click(screen.getByRole("button", { name: "Snooze: Start the products-only pilot now?" }));
    await save("asks-picker");
  }
});

