import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RosterBot } from "./bots";
import { makeThread } from "./fixtures";
import { makeNeed } from "./needsFixtures";
import { CrewRailIcon, publishCrewSignal } from "./crewSignal";
import { crewCard } from "./CrewWorkspace";

const app = await loadPluginApp(() => import("../../app"));
const panel = app.navPanels.find(p => p.id === "crew")!;
afterEach(() => { cleanup(); localStorage.clear(); publishCrewSignal({ needs: 0, working: false, failed: false }); });
const home: RosterBot = { key: "home", name: "Home Bot", current: "coord", projectId: "p", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const work: RosterBot = { key: "work", name: "Work Bot", current: "work-coord", projectId: "w", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const now = Date.now();
const chatgpt = { connected: true, status: { reportedAt: new Date().toISOString(),
  alerts: { watching: true, refreshBefore: new Date(now + 5 * 86400_000).toISOString(), watches: [], lastDeliveredAt: null },
  activity: { home: { instructions: 3, lastAt: now - 600_000 } } } };
function sdk(status: unknown = chatgpt) {
  return { plugins: { callRpc: async <TOutput,>({ pluginId }: { pluginId: string }) => (pluginId === "chatgpt-events" ? status : { bots: [home, work] }) as TOutput } };
}
const threads = [
  makeThread({ id: "coord", title: "Home Bot" }),
  makeThread({ id: "work-coord", title: "Work Bot" }),
  makeThread({ id: "cameras", title: "Inspect cameras", lifecycleOwnerThreadId: "coord", status: "active", isHidden: true }),
  makeThread({ id: "approval", title: "Approve router change", parentThreadId: "coord", hasPendingInteraction: true }),
  makeThread({ id: "old-failure", title: "Last week's failure", parentThreadId: "coord", status: "error", updatedAt: now - 5 * 86400_000 }),
  makeThread({ id: "finished", title: "Finished job", parentThreadId: "work-coord" }),
];

it("puts saved asks and pending approvals first, and closes an ask on the shared list", async () => {
  const items = [makeNeed({ id: "need1", text: "Current balance?" })];
  const slot = renderSlot(panel, { subPath: "" }, {
    rpc: { crew_needs_list: () => ({ items }), crew_needs_update: (input: unknown) => ({ item: { ...items[0]!, id: (input as { id: string }).id, state: "done" } }) },
    sdk: sdk(), sidebarThreads: { status: "ready", threads },
  });
  await screen.findByText("Current balance?");
  const approvals = screen.getByRole("list", { name: "Waiting for your answer or approval" });
  fireEvent.click(within(approvals).getByRole("button", { name: "Review" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "approval" });
  fireEvent.click(screen.getByRole("button", { name: "Mark done: Current balance?" }));
  await act(async () => {});
  expect(slot.inspection.rpcCalls.find(c => c.method === "crew_needs_update")?.input).toMatchObject({ id: "need1", action: "done" });
});

it("shows one card per bot with live hidden workers, counts old failures, and opens the worker", async () => {
  const slot = renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk(), sidebarThreads: { status: "ready", threads } });
  const card = await screen.findByRole("article", { name: "Home Bot: Needs you" });
  expect(within(card).queryByText("Last week's failure")).toBeNull();
  expect(within(card).getByText("1 older failed worker")).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: /Inspect cameras/ }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "cameras" });
  expect(screen.getByRole("article", { name: "Work Bot: Quiet" })).toBeTruthy();
  expect(within(screen.getByRole("article", { name: "Work Bot: Quiet" })).queryByText("Finished job")).toBeNull();
  // The coordinator chat, history and audit views are gone with the Crew Bot.
  for (const name of ["Chat", "History"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByText("Settings & activity log")).toBeNull();
});

it("says whether ChatGPT is coordinating and how much it steered each bot", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk(), sidebarThreads: { status: "ready", threads } });
  expect((await screen.findByText(/ChatGPT coordinating · alerts on until/)).className).toContain("crew-chatgpt-ok");
  expect(await screen.findByText(/ChatGPT sent 3 instructions today/)).toBeTruthy();
});

it("warns before ChatGPT alerts lapse and when the bridge stops reporting", async () => {
  const ending = { ...chatgpt, status: { ...chatgpt.status, alerts: { ...chatgpt.status.alerts, refreshBefore: new Date(now + 3600_000).toISOString() } } };
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk(ending), sidebarThreads: { status: "ready", threads } });
  expect(await screen.findByText(/ChatGPT alerts end .*: ask it to watch your BB bots again/)).toBeTruthy();
  cleanup();
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk({ ...chatgpt, connected: false }), sidebarThreads: { status: "ready", threads } });
  expect(await screen.findByText(/ChatGPT bridge is not running/)).toBeTruthy();
});

it("does not claim all clear while live bot activity is unavailable", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk(), sidebarThreads: { status: "error", threads: [] } as never });
  expect(await screen.findByText("Live bot activity is unavailable.")).toBeTruthy();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
  cleanup();
  // A bot whose coordinator is missing from the list is not known to be clear either.
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: sdk(), sidebarThreads: { status: "ready", threads: threads.filter(t => t.id !== "work-coord") } });
  expect(await screen.findByRole("article", { name: /Work Bot/ })).toBeTruthy();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
});

it("rail icon shows what needs Salem, else a working dot", () => {
  const { container } = render(<CrewRailIcon />);
  expect(container.querySelector("text")).toBeNull();
  act(() => publishCrewSignal({ needs: 3, working: true, failed: false }));
  expect(container.querySelector("text")?.textContent).toBe("3");
  act(() => publishCrewSignal({ needs: 0, working: true, failed: false }));
  expect(container.querySelector(".crew-rail-working")).toBeTruthy();
  act(() => publishCrewSignal({ needs: 12, working: false, failed: false }));
  expect(container.querySelector("text")?.textContent).toBe("9+");
});

it("treats a sign-off as nothing new rather than the bot's latest news", () => {
  const quiet = crewCard(home, threads, { subject: "Nothing to do.", preview: "Nothing to do.", decision: null, quiet: true }, [], null, now);
  expect(quiet.reply).toMatchObject({ quiet: true });
  const finding = crewCard(home, threads, { subject: "Run 9 passed", preview: "Run 9 passed", decision: null, quiet: true }, [], null, now);
  expect(finding.reply).toMatchObject({ text: "Run 9 passed", quiet: false });
});
