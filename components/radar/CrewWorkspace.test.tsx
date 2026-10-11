import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Automation, AutomationHealth } from "@/lib/automationHealth";
import type { RosterBot } from "./bots";
import { makeThread } from "./fixtures";
import { makeNeed } from "./needsFixtures";
import { CrewRailIcon, publishCrewSignal } from "./crewSignal";
import { CrewWorkspace, crewCard } from "./CrewWorkspace";

const app = await loadPluginApp(() => import("../../app"));
const panel = { id: "crew-legacy-fixture", title: "Legacy Crew", component: CrewWorkspace };
afterEach(() => { cleanup(); localStorage.clear(); publishCrewSignal({ needs: 0, working: false, failed: false }); });
const home: RosterBot = { key: "home", name: "Home Bot", current: "coord", projectId: "p", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const work: RosterBot = { key: "work", name: "Work Bot", current: "work-coord", projectId: "w", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const now = Date.now();
const chatgpt = { connected: true, status: { reportedAt: new Date().toISOString(),
  alerts: { watching: true, refreshBefore: new Date(now + 5 * 86400_000).toISOString(), watches: [], lastDeliveredAt: null },
  activity: { home: { instructions: 3, lastAt: now - 600_000 } } } };
function sdk(status: unknown = chatgpt, health: AutomationHealth | Error = new Error("Unknown RPC")) {
  return { plugins: { callRpc: async <TOutput,>({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }) => {
    if (pluginId === "saelmbot-automations") {
      expect(method).toBe("automation_health");
      expect(input).toEqual({});
      if (health instanceof Error) throw health;
      return health as TOutput;
    }
    return (pluginId === "chatgpt-events" ? status : { bots: [home, work] }) as TOutput;
  } } };
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

it("shows exact important MR alerts and acknowledges one without closing work", async () => {
  const events = [1, 2].map(seq => ({ seq, id: `att_${seq}`, bot: "home", source: `run:mr${seq}`, threadId: "coord", summary: seq === 1 ? "be!738: blocking review requires changes." : "fe!977: remove background location in both flavors.", needsItemId: null, createdAt: now, seenAt: null }));
  const slot = renderSlot(panel, { subPath: "" }, {
    rpc: { crew_needs_list: () => ({ items: [] }), crew_attention_list: () => ({ page: { events, cursor: 2, more: false } }), crew_attention_seen: () => ({ acknowledged: 1 }) },
    sdk: sdk(), sidebarThreads: { status: "ready", threads },
  });
  await screen.findByText(/be!738: blocking/);
  const region = screen.getByRole("region", { name: "Important alerts" });
  fireEvent.click(within(region).getAllByRole("button", { name: "Open" })[0]!);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "coord" });
  if (process.env.RADAR_QA_DIR) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${process.env.RADAR_QA_DIR}/attention.html`, document.body.innerHTML);
  }
  fireEvent.click(within(region).getAllByRole("button", { name: "Seen" })[0]!);
  await act(async () => {});
  expect(slot.inspection.rpcCalls.find(c => c.method === "crew_attention_seen")?.input).toEqual({ ids: ["att_1"] });
  expect(slot.inspection.rpcCalls.some(c => c.method === "crew_needs_update")).toBe(false);
  expect(screen.queryByText(/be!738: blocking/)).toBeNull();
  expect(screen.getByText(/fe!977: remove/)).toBeTruthy();
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

function automation(state: Automation["state"], fields: Partial<Automation> = {}): Automation {
  return { id: state, name: `${state} schedule`, projectId: "p", state, lastSuccessAt: null, failingSince: null,
    nextRunAt: null, pausedUntil: null, pauseReason: null, waitingOn: null, incident: null, ...fields };
}
function automationHealth(items: Automation[]): AutomationHealth {
  return { generatedAt: new Date(now).toISOString(), bots: { home: { automations: items }, work: { automations: [] } } };
}
const quietThreads = threads.filter(thread => thread.id === "coord" || thread.id === "work-coord");
const incident = { id: "incident", openedAt: "2026-10-10T08:00:00Z", attempt: 1 as const, repairThreadId: "repair", needsItemId: "need-auto", summary: "Check the schedule" };

it("summarizes non-zero automation states in priority order and opens a repair", async () => {
  const items = [automation("healthy"), automation("paused", { pausedUntil: "2026-10-11T08:00:00Z" }),
    automation("failing"), automation("waiting", { id: "capacity", waitingOn: "capacity" }),
    automation("waiting", { waitingOn: "host" }), automation("repairing", { incident }),
    automation("overdue"), automation("blocked")];
  const slot = renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) },
    sdk: sdk(chatgpt, automationHealth(items)), sidebarThreads: { status: "ready", threads: quietThreads } });
  const card = await screen.findByRole("article", { name: "Home Bot: Needs you" });
  const summary = "1 blocked · 1 overdue · 1 being fixed · 1 waiting on host · 1 waiting on capacity · 1 failing · 1 paused until Sun · 1 healthy";
  const toggle = await within(card).findByRole("button", { name: `Home Bot automations: ${summary}` });
  expect(toggle.textContent).toBe(summary);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(within(card).queryByRole("list", { name: "Home Bot automation details" })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const details = within(card).getByRole("list", { name: "Home Bot automation details" });
  expect(within(details).getAllByRole("listitem")).toHaveLength(7);
  expect(within(details).queryByText("healthy schedule")).toBeNull();
  expect(within(details).getByText("Sat 10 Oct, 11:00").getAttribute("dateTime")).toBe(incident.openedAt);
  fireEvent.click(within(details).getByRole("button", { name: "Open repair thread for repairing schedule" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "repair" });
  fireEvent.click(toggle);
  expect(within(card).queryByRole("list", { name: "Home Bot automation details" })).toBeNull();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
});

it("leaves out unavailable automation health without claiming healthy automations", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) },
    sdk: sdk(chatgpt, new Error("Older plugin has no RPC method")), sidebarThreads: { status: "ready", threads: quietThreads } });
  await screen.findByRole("article", { name: "Home Bot: Quiet" });
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /automations:/ })).toBeNull();
  expect(screen.queryByText(/healthy/)).toBeNull();
  expect(screen.queryByText(/Older plugin/)).toBeNull();
});

it("shows healthy automations only as a count", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) },
    sdk: sdk(chatgpt, automationHealth([automation("healthy"), automation("healthy", { id: "second" })])),
    sidebarThreads: { status: "ready", threads: quietThreads } });
  expect(await screen.findByText("2 healthy")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /automations:/ })).toBeNull();
  expect(screen.queryByText("healthy schedule")).toBeNull();
});

it("keeps blocked automation asks on the saved list without repeating their pending interaction", async () => {
  const saved = makeNeed({ id: "need-auto", bot: "home", text: "Approve schedule repair", source: { automationId: "blocked" } });
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [saved] }) },
    sdk: sdk(chatgpt, automationHealth([automation("blocked", { incident })])),
    sidebarThreads: { status: "ready", threads: [...quietThreads, makeThread({ id: "repair", parentThreadId: "coord", hasPendingInteraction: true })] } });
  await screen.findByRole("button", { name: "Home Bot automations: 1 blocked" });
  expect(screen.getAllByText("Approve schedule repair")).toHaveLength(1);
  expect(screen.queryByRole("list", { name: "Waiting for your answer or approval" })).toBeNull();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
  expect(screen.getByRole("article", { name: "Home Bot: Needs you" })).toBeTruthy();
});

it("overdue health changes a quiet card to failed and prevents all clear", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) },
    sdk: sdk(chatgpt, automationHealth([automation("overdue")])), sidebarThreads: { status: "ready", threads: quietThreads } });
  expect(await screen.findByRole("article", { name: "Home Bot: Failed" })).toBeTruthy();
  expect(screen.queryByText("Nothing needs you.")).toBeNull();
});

it("drops previously healthy counts silently when the health refresh fails", async () => {
  const fake = sdk(chatgpt, automationHealth([automation("healthy")]));
  let unavailable = false;
  const call = fake.plugins.callRpc;
  fake.plugins.callRpc = async args => {
    if (unavailable && args.pluginId === "saelmbot-automations") throw new Error("Offline");
    return call(args);
  };
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [] }) }, sdk: fake,
    sidebarThreads: { status: "ready", threads: quietThreads } });
  await screen.findByText("1 healthy");
  unavailable = true;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(screen.queryByText("1 healthy")).toBeNull();
  expect(screen.queryByText("Offline")).toBeNull();
});

it("keeps unrelated pending approvals visible beside a saved blocked automation ask", async () => {
  const saved = makeNeed({ id: "need-auto", bot: "home", text: "Approve schedule repair", source: { threadId: "repair" } });
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [saved] }) },
    sdk: sdk(chatgpt, automationHealth([automation("blocked", { incident })])), sidebarThreads: { status: "ready", threads: [
      ...quietThreads, makeThread({ id: "repair", parentThreadId: "coord", hasPendingInteraction: true }),
      makeThread({ id: "unrelated", title: "Approve router change", parentThreadId: "coord", hasPendingInteraction: true }),
    ] } });
  await screen.findByRole("button", { name: "Home Bot automations: 1 blocked" });
  const pending = screen.getByRole("list", { name: "Waiting for your answer or approval" });
  expect(within(pending).getAllByRole("listitem")).toHaveLength(1);
  expect(within(pending).getByText(/Approve router change/)).toBeTruthy();
});

it("does not hide an approval just because another saved ask came from the same thread", async () => {
  const saved = makeNeed({ id: "unrelated-need", bot: "home", text: "Current balance?", source: { threadId: "coord" } });
  renderSlot(panel, { subPath: "" }, { rpc: { crew_needs_list: () => ({ items: [saved] }) },
    sdk: sdk(chatgpt, automationHealth([automation("blocked", { incident })])), sidebarThreads: { status: "ready", threads: [
      ...quietThreads.filter(thread => thread.id !== "coord"), makeThread({ id: "coord", hasPendingInteraction: true }),
    ] } });
  await screen.findByRole("button", { name: "Home Bot automations: 1 blocked" });
  expect(screen.getByRole("list", { name: "Waiting for your answer or approval" })).toBeTruthy();
});
