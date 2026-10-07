import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { resetHiddenBots } from "./botVisibility";
import { RadarCrewView } from "./RadarCrewView";
import { useNeedsYou } from "./useCrewData";
import { makeThread } from "./fixtures";
import { NEEDS_BOT, NEEDS_NOW, makeNeed } from "./needsFixtures";

const app = await loadPluginApp(() => import("../../app"));
afterEach(() => { cleanup(); resetHiddenBots(); });

it.each([
  ["failed", { status: "error" }, null, /Its last turn failed/],
  ["needs-you", { hasPendingInteraction: true }, null, /Waiting for your answer/],
  ["decision", {}, "Decision needed: Approve the repair?", /Approve the repair/],
  ["working", { status: "active" }, null, /Working.*Thinking/],
  ["queued", { queuedWork: "waiting" }, null, /Queued, waiting to run/],
  ["rollover", {}, null, /Coordinator handover in progress/],
  ["unread", { isUnread: true }, "The report is ready.", /The report is ready/],
  ["idle", {}, "The report is ready.", /Idle/],
  ["unavailable", null, null, /Coordinator state unavailable/],
] as const)("renders and opens the affected coordinator for Crew %s", async (state, extra, output, label) => {
  const onNavigate = vi.fn();
  const bot = { ...NEEDS_BOT, rollover: state === "rollover" ? "replacement" : null };
  const slot = renderSlot({ ...app.threadPanelActions[0]!, component: () => {
    const needs = useNeedsYou();
    return <RadarCrewView roster={[bot]} now={NEEDS_NOW} onNavigate={onNavigate} needs={needs} />;
  } }, { threadId: "other", params: null }, {
    sidebarThreads: { threads: extra ? [makeThread({ id: "coord", ...extra })] : [] },
    rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }), crew_automations: () => ({ automations: [] }), crew_jobs: () => ({ jobs: [] }) },
    sdk: { threads: { output: async () => ({ output }), context: async () => ({ usage: null }) } },
  });
  const button = await screen.findByRole("button", { name: label });
  await act(async () => {});
  if (process.env.RADAR_QA_DIR) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${process.env.RADAR_QA_DIR}/crew-${state}.html`, slot.container.innerHTML);
  }
  fireEvent.click(button);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "coord" });
  expect(onNavigate).toHaveBeenCalledOnce();
});

it("keeps a fixed bot roster, says saved asks once, and expands flat history", async () => {
  const roster = ["personal", "home", "bricks", "work", "erbareeq"].map(key => ({ ...NEEDS_BOT, key, name: `${key === "erbareeq" ? "ERBareeq" : key[0]!.toUpperCase() + key.slice(1)} Bot`, current: key }));
  const threads = [
    makeThread({ id: "personal", isUnread: true }), makeThread({ id: "home" }), makeThread({ id: "bricks" }),
    makeThread({ id: "work", status: "error" }), makeThread({ id: "erbareeq" }),
    ...Array.from({ length: 6 }, (_, i) => makeThread({ id: `job${i}`, parentThreadId: "bricks", title: i === 0 ? "be#2 pilot: products split-AND search + benchmarks" : `Pilot check ${i}`, status: i === 0 ? "active" : "idle", createdAt: NEEDS_NOW - i * 60_000 })),
  ];
  const ask = "I need the current Mum apt meter balance when you have it.";
  const slot = renderSlot({ ...app.threadPanelActions[0]!, component: () => {
    const needs = useNeedsYou(); return <RadarCrewView roster={roster} now={NEEDS_NOW} onNavigate={() => {}} needs={needs} />;
  } }, { threadId: "other", params: null }, {
    sidebarThreads: { threads },
    rpc: { crew_needs_list: () => ({ items: [makeNeed({ text: ask, due: null, source: { threadId: "home" } })] }), crew_asks: () => ({ judgements: [] }), crew_automations: () => ({ automations: [] }), crew_jobs: () => ({ jobs: [] }) },
    sdk: { threads: { output: async ({ threadId }) => ({ output: threadId === "home" ? `Decision needed: ${ask}` : "The report is ready." }), context: async () => ({ usage: null }) } },
  });
  await screen.findByRole("button", { name: /^Open: I need/ });
  const crew = screen.getByRole("region", { name: "Crew" });
  await screen.findByText("Waiting on your answer above");
  expect(Array.from(crew.querySelectorAll("li[data-bot]")).map(row => row.getAttribute("data-bot"))).toEqual(["personal", "home", "bricks", "work", "erbareeq"]);
  expect(screen.getAllByText(ask)).toHaveLength(1);
  expect(within(crew).getByRole("button", { name: /Bricks, Working/ })).toBeTruthy();
  fireEvent.click(within(crew).getByRole("button", { name: /Work, Failed/ }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "work" });
  const today = screen.getByRole("region", { name: "Today's work" });
  expect(within(today).getAllByRole("listitem")).toHaveLength(5);
  if (process.env.RADAR_QA_DIR) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${process.env.RADAR_QA_DIR}/crew-a.html`, slot.container.innerHTML);
  }
  fireEvent.click(within(today).getByRole("button", { name: "Show all 6 jobs" }));
  expect(within(today).getAllByRole("listitem")).toHaveLength(6);
  fireEvent.click(within(today).getByRole("button", { name: "Show less" }));
  expect(within(today).getAllByRole("listitem")).toHaveLength(5);
});

it.each([false, true])("offers touch hide/show while preserving an attention override (unread failure=%s)", async failed => {
  const bot = NEEDS_BOT;
  renderSlot({ ...app.threadPanelActions[0]!, component: () => {
    const needs = useNeedsYou(); return <RadarCrewView roster={[bot]} now={NEEDS_NOW} onNavigate={() => {}} needs={needs} />;
  } }, { threadId: "other", params: null }, {
    // A failure only overrides hiding while it is unread; bb never clears the error status on read.
    sidebarThreads: { threads: [makeThread({ id: "coord", status: failed ? "error" : "idle", isUnread: failed })] },
    rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }), crew_automations: () => ({ automations: [] }), crew_jobs: () => ({ jobs: [] }) },
    sdk: { threads: { output: async () => ({ output: "Nothing to do." }), context: async () => ({ usage: null }) } },
  });
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Bot visibility" }));
  const checkbox = screen.getByRole("checkbox", { name: "Show Home" }) as HTMLInputElement;
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(false);
  const crew = screen.getByRole("region", { name: "Crew" });
  expect(!!within(crew).queryByRole("button", { name: /Home, (Idle|Failed):/ })).toBe(failed);
  fireEvent.click(checkbox);
  expect(within(crew).getByRole("button", { name: /Home, (Idle|Failed):/ })).toBeTruthy();
});

it("opens the unread worker when a read coordinator has an unread family reply", async () => {
  const slot = renderSlot({ ...app.threadPanelActions[0]!, component: () => {
    const needs = useNeedsYou(); return <RadarCrewView roster={[NEEDS_BOT]} now={NEEDS_NOW} onNavigate={() => {}} needs={needs} />;
  } }, { threadId: "other", params: null }, {
    sidebarThreads: { threads: [makeThread({ id: "coord" }), makeThread({ id: "unread-worker", parentThreadId: "coord", isUnread: true })] },
    rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }), crew_automations: () => ({ automations: [] }), crew_jobs: () => ({ jobs: [] }) },
    sdk: { threads: { output: async () => ({ output: "Report is ready." }), context: async () => ({ usage: null }) } },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Home, New reply:/ }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "unread-worker" });
});

it("surfaces a hidden bot with a saved ask and keeps the bot name in the inbox", async () => {
  renderSlot({ ...app.threadPanelActions[0]!, component: () => {
    const needs = useNeedsYou(); return <RadarCrewView roster={[NEEDS_BOT]} now={NEEDS_NOW} onNavigate={() => {}} needs={needs} />;
  } }, { threadId: "other", params: null }, {
    sidebarThreads: { threads: [makeThread({ id: "coord" })] },
    rpc: { crew_needs_list: () => ({ items: [makeNeed()] }), crew_asks: () => ({ judgements: [] }), crew_automations: () => ({ automations: [] }), crew_jobs: () => ({ jobs: [] }) },
    sdk: { threads: { output: async () => ({ output: "Nothing to do." }), context: async () => ({ usage: null }) } },
  });
  await screen.findByRole("button", { name: /^Open:/ });
  fireEvent.click(screen.getByRole("button", { name: "Bot visibility" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Home" }));
  expect(screen.getByRole("button", { name: /Home, Idle:/ })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Needs you" })).getByText("Home")).toBeTruthy();
});
