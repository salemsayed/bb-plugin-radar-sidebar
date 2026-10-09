import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { CrewBoard } from "@/lib/crewContract";
import type { RosterBot } from "./bots";
import { makeThread } from "./fixtures";

const app = await loadPluginApp(() => import("../../app"));
const panel = app.navPanels.find(p => p.id === "crew")!;
afterEach(() => { cleanup(); localStorage.clear(); });
const bot: RosterBot = { key: "home", name: "Home Bot", current: "coord", projectId: "p", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const board: CrewBoard = { control: { mode: "live", paused: false, coordinator: null, projectId: null, environmentId: null, epoch: null, creating: false }, work: [{ id: "w", key: "meter", title: "Meter", owner: "home", origin: "legacy", stage: "unknown", revision: 1, createdAt: 1, updatedAt: 1, evidence: null }], requests: [{ id: "q", workId: "w", key: "balance", text: "Current balance?", version: 3, state: "open", placement: "needs_you", due: null, snoozeUntil: null, sourceIds: [], sourceVersions: {}, answer: null, evidence: null, updatedAt: 1 }], commands: [], reviews: [], events: [], sources: [], bots: [{ key: "home", name: "Home Bot", current: "coord" }], refreshedAt: 1, warning: null };
const sdk = { plugins: { callRpc: async <TOutput,>() => ({ bots: [bot] }) as TOutput } };

it("binds the exact answer to the selected request version", async () => {
  const slot = renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => board, crew_user_request: () => board }, sdk });
  await screen.findByText("Current balance?");
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByLabelText("Exact answer"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
  await act(async () => {});
  expect(slot.inspection.rpcCalls.find(c => c.method === "crew_user_request")?.input).toMatchObject({ requestId: "q", expectedVersion: 3, text: "200", action: "answer" });
});

it("retains saved requests and an actionable error if source refresh fails", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => board, crew_refresh: () => { throw new Error("Source offline"); } }, sdk });
  await screen.findByText("Current balance?");
  fireEvent.click(screen.getByText("Settings & activity log"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh sources" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Source offline");
  expect(screen.getByText("Current balance?")).toBeTruthy();
});

it("shows runtime work without a tracked assignment and opens the actual worker", async () => {
  const slot = renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => board }, sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "coord" }), makeThread({ id: "worker", lifecycleOwnerThreadId: "coord", status: "active", isHidden: true, title: "Inspect cameras" })] } });
  const job = await screen.findByRole("button", { name: /Home Bot, Working: Inspect cameras/ });
  expect(screen.queryByText(/records/)).toBeNull();
  expect(screen.queryByRole("region", { name: "Coordinator chat" })).toBeNull();
  fireEvent.click(job);
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "worker" });
});

it("keeps reminders compact, past requests in History, and operational controls secondary", async () => {
  const data: CrewBoard = { ...board, requests: [...board.requests, { ...board.requests[0]!, id: "reminder", key: "descale", text: "Descale the machine", placement: "reminders" }, { ...board.requests[0]!, id: "past", key: "old", text: "Already answered", state: "answered" }] };
  renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => data }, sdk });
  const summary = await screen.findByText("Descale the machine", { selector: ".crew-compact-text" });
  expect(summary.closest("details")?.open).toBe(false);
  expect(screen.queryByText("Already answered")).toBeNull();
  expect(screen.getByText("Settings & activity log").closest("details")?.open).toBe(false);
  fireEvent.click(summary);
  expect(summary.closest("details")?.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  await screen.findByText("Already answered", { selector: ".crew-compact-text" });
  expect(screen.queryByText("Current balance?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  expect(screen.getByRole("region", { name: "Coordinator chat" })).toBeTruthy();
});

it("surfaces pending worker input above activity and routes it to that worker", async () => {
  const slot = renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => ({ ...board, requests: [] }) }, sdk, sidebarThreads: { status: "ready", threads: [makeThread({ id: "coord" }), makeThread({ id: "approval", parentThreadId: "coord", title: "Approve camera access", hasPendingInteraction: true })] } });
  const needs = await screen.findByRole("region", { name: "Needs your answer" });
  await within(needs).findByText("Approve camera access");
  fireEvent.click(within(needs).getByRole("button", { name: "Review request" }));
  expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "approval" });
  expect(screen.queryByText("All bots are quiet.")).toBeNull();
});

it("does not claim a quiet team while live activity is unavailable", async () => {
  renderSlot(panel, { subPath: "" }, { rpc: { crew_board: () => board }, sdk, sidebarThreads: { status: "error", threads: [] } });
  await screen.findByText("Current balance?");
  expect(screen.getByText("Live bot activity is unavailable. Saved requests are still shown.")).toBeTruthy();
  expect(screen.queryByText("All bots are quiet.")).toBeNull();
});
