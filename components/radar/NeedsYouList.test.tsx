import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { NeedsYouList } from "./NeedsYouList";
import { useNeedsYou } from "./useCrewData";
import { NEEDS_BOT, NEEDS_NOW, makeNeed } from "./needsFixtures";
import { RadarCrewView } from "./RadarCrewView";

const app = await loadPluginApp(() => import("../../app"));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(items = [makeNeed()]) {
  const update = vi.fn(async () => {}), open = vi.fn();
  return { update, open, ...render(<NeedsYouList items={items} roster={[NEEDS_BOT]} now={NEEDS_NOW} onUpdate={update} onOpen={open} />) };
}

it("renders two-line asks in due order with bot faces and visible snoozed reminders", () => {
  mount([makeNeed({ id: "late", text: "Later", due: "2026-10-15", kind: "deadline" }), makeNeed({ id: "now", text: "Now", due: "2026-10-07", kind: "urgent" }), makeNeed({ id: "none", text: "No date", due: null }), makeNeed({ id: "hidden", state: "snoozed", text: "Snoozed reminder", snoozeUntil: "2026-10-08T06:00Z" }), makeNeed({ id: "done", state: "done", text: "Done item" })]);
  expect(screen.getAllByRole("listitem").map(row => row.querySelector(".radar-needs-text")?.textContent)).toEqual(["Now", "Snoozed reminder", "Later", "No date"]);
  expect(screen.getByText("today")).toBeTruthy(); expect(screen.getByText("15 Oct")).toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Home Bot" })).toHaveLength(4);
  expect(screen.getByText("Snoozed until 8 Oct, 09:00 Cairo")).toBeTruthy();
  expect(screen.getByText("Snoozed reminder").getAttribute("title")).toBeNull();
});
it("offers Done, all Snooze times, native date/time, and Open without hover", async () => {
  const host = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(host.open).toHaveBeenCalledWith("coord");
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  expect(screen.getByRole("button", { name: "Later today · 18:00" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Monday · 09:00" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tomorrow · 09:00" }));
  await waitFor(() => expect(host.update).toHaveBeenCalledWith("need1", "snooze", "2026-10-08T06:00:00.000Z"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(host.update).toHaveBeenCalledWith("need1", "done", undefined));
});
it("keeps failed changes visible and reports a retryable error", async () => {
  const host = mount(); host.update.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Snooze" }).hasAttribute("disabled")).toBe(false));
  fireEvent.touchStart(row, { touches: [{ clientX: 250, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 230, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 90, clientY: 100 }] });
  fireEvent.touchEnd(row, { touches: [] });
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
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
    expect(screen.queryByText("Approve the repair")).toBeNull();
    const calls = load.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(load.mock.calls.length).toBeGreaterThan(calls);
  });
  it("renders Needs you first in the Crew view and opens the source thread", async () => {
    const navigate = vi.fn();
    const host = renderSlot({ ...slot, component: () => { const needs = useNeedsYou(); return <RadarCrewView roster={[NEEDS_BOT]} now={NEEDS_NOW} onNavigate={navigate} needs={needs} />; } }, { threadId: "coord", params: null }, {
      rpc: { crew_needs_list: () => ({ items: [makeNeed()] }) },
    });
    const region = await screen.findByRole("region", { name: "Needs you" });
    expect(region.parentElement?.firstElementChild).toBe(region);
    fireEvent.click(within(region).getByRole("button", { name: "Open" }));
    expect(host.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "coord" });
    expect(navigate).toHaveBeenCalledOnce();
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
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
  expect(screen.queryByText("Approve the repair")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
  expect(update).toHaveBeenLastCalledWith({ id: "need1", action: "reopen" });
  expect(screen.getByText("Approve the repair")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
  await act(async () => { vi.advanceTimersByTime(5_999); });
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
it("shares one needs request/interval between the sidebar digest and Crew view", async () => {
  vi.useFakeTimers();
  const load = vi.fn(() => ({ items: [makeNeed()] }));
  function component() {
    const needs = useNeedsYou();
    return <><output>{needs.items?.length ?? 0} sidebar items</output><RadarCrewView roster={[NEEDS_BOT]} now={NEEDS_NOW} onNavigate={() => {}} needs={needs} /></>;
  }
  renderSlot({ ...app.threadPanelActions[0]!, component }, { threadId: "coord", params: null }, { rpc: { crew_needs_list: load } });
  await act(async () => {});
  expect(screen.getByText("1 sidebar items")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Needs you" })).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(load).toHaveBeenCalledTimes(2);
});
