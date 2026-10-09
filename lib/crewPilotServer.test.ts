// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createCrewPilotServer } from "./crewPilotServer";
import { makeNeed, NEEDS_BOT } from "../components/radar/needsFixtures";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
async function setup() {
  let items = [makeNeed({ id: "n1", due: null, bot: "home", source: { threadId: "coord" } })];
  let action = "later";
  let calls = 0;
  let fail = false;
  let wait: Promise<void> = Promise.resolve();
  const invoked: string[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: {
    plugins: { callRpc: async ({ method }: { method: string }) => {
      invoked.push(method);
      if (method === "needs_list") return { items: structuredClone(items) };
      if (method === "bot_roster") return { bots: [{ ...NEEDS_BOT, key: "home" }] };
      if (method === "jev_decide") { calls++; await wait; if (fail) throw new Error("down"); return { answers: { action: { choice: action }, owner: { choice: "b0" } }, model: "test", latencyMs: 12 }; }
      throw new Error(`Unexpected mutation: ${method}`);
    } },
  } as never });
  dispose.push(() => harness.lifecycle.dispose());
  const server = createCrewPilotServer(bb);
  const board = await server.crew_pilot_refresh();
  return { server, bb, board, invoked, calls: () => calls, setAction: (v: string) => { action = v; }, setFail: () => { fail = true; },
    change: () => { items[0]!.text = "New question"; }, setWait: (v: Promise<void>) => { wait = v; },
    input: { commandId: "cmd1", text: "Move to Later", needId: "n1", sourceVersion: board.versions.n1! } };
}
it("keeps reviewed moves in a durable shadow preview without mutating live cards", async () => {
  const h = await setup();
  const entry = await h.server.crew_pilot_send(h.input);
  expect(entry.action).toBe("later");
  let board = await h.server.crew_pilot_review({ id: entry.id, review: "correct" });
  expect(board.placements.n1?.value).toBe("later");
  expect(board.snapshot?.items[0]?.state).toBe("open");
  board = await createCrewPilotServer(h.bb).crew_pilot_board();
  expect(board.placements.n1?.value).toBe("later");
  expect(board.entries[0]?.review).toBe("correct");
  expect(new Set(h.invoked)).toEqual(new Set(["needs_list", "bot_roster", "jev_decide"]));
});
it("deduplicates concurrent requests and rejects conflicting reuse of an ID", async () => {
  const h = await setup();
  let release!: () => void; h.setWait(new Promise(resolve => { release = resolve; }));
  const a = h.server.crew_pilot_send(h.input);
  const b = h.server.crew_pilot_send(h.input);
  await expect(h.server.crew_pilot_send({ ...h.input, text: "Different" })).rejects.toThrow("command ID");
  release();
  expect(await a).toEqual(await b); expect(h.calls()).toBe(1);
  await h.server.crew_pilot_send(h.input); expect(h.calls()).toBe(1);
});
it("rejects stale bound replies and invalidates a preview when the source changes", async () => {
  const h = await setup();
  await h.server.crew_pilot_send(h.input);
  await h.server.crew_pilot_review({ id: "cmd1", review: "correct" });
  h.change();
  const board = await h.server.crew_pilot_refresh();
  expect(board.placements).toEqual({});
  await expect(h.server.crew_pilot_send({ ...h.input, commandId: "cmd2" })).rejects.toThrow("changed");
});
it("checks live source revisions at review time", async () => {
  const h = await setup(); await h.server.crew_pilot_send(h.input); h.change();
  await expect(h.server.crew_pilot_review({ id: "cmd1", review: "correct" })).rejects.toThrow("source changed");
});
it("does not close an answered request or treat a dispatch proposal as started work", async () => {
  const h = await setup(); h.setAction("answer");
  const answer = await h.server.crew_pilot_send({ ...h.input, text: "The balance is 200" });
  expect(answer.reply).toContain("stays open");
  expect((await h.server.crew_pilot_review({ id: answer.id, review: "correct" })).placements).toEqual({});
  h.setAction("assign");
  const assign = await h.server.crew_pilot_send({ commandId: "cmd2", text: "Ask Home to inspect the meter" });
  expect(assign.reply).toContain("Nothing was sent"); expect(assign.action).toBe("assign");
});
it("rejects unbound Yes without a model call and cannot hide an unbound card", async () => {
  const h = await setup();
  expect((await h.server.crew_pilot_send({ commandId: "cmd1", text: "Yes" })).action).toBe("clarify");
  expect(h.calls()).toBe(0);
  expect((await h.server.crew_pilot_send({ commandId: "cmd2", text: "hide this" })).action).toBe("clarify");
  expect((await h.server.crew_pilot_board()).placements).toEqual({});
});
it("saves failures and retains source data when the coordinator is unavailable", async () => {
  const h = await setup(); h.setFail();
  expect((await h.server.crew_pilot_send(h.input)).status).toBe("failed");
  const board = await h.server.crew_pilot_board();
  expect(board.snapshot?.items).toHaveLength(1); expect(board.entries[0]?.text).toBe(h.input.text);
});
it("recovers unfinished proposals after restart without dispatch or another model call", async () => {
  const h = await setup();
  const { createPilotStore } = await import("./crewPilotStore");
  createPilotStore(h.bb.storage.database()).begin(h.input, Date.now());
  const board = await createCrewPilotServer(h.bb).crew_pilot_board();
  expect(board.entries[0]?.status).toBe("failed"); expect(h.calls()).toBe(0);
});
it("routes an explicit named assignment without asking the classifier to reinterpret it", async () => {
  const h = await setup();
  h.setAction("clarify");
  const entry = await h.server.crew_pilot_send({ commandId: "cmd1", text: "Ask Home to investigate the meter issue." });
  expect(entry.action).toBe("assign"); expect(entry.owner).toBe("home"); expect(h.calls()).toBe(0);
});
