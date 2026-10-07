// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { needsAddSchema, needsResultSchema, type NeedsItem } from "./needs";
import { NEEDS_BOT, NEEDS_NOW, makeNeed } from "../components/radar/needsFixtures";

const disposers: (() => Promise<void>)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NEEDS_NOW); });
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); vi.restoreAllMocks(); });
async function setup() {
  const items: NeedsItem[] = [];
  let available = true;
  let jevAvailable = true;
  let output = "Should I approve the repair?";
  let version = 0;
  let answered = false;
  let resolveScore = 0.99;
  const outputFn = vi.fn(async () => ({ output }));
  const get = vi.fn(async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, latestAttentionAt: version, parentThreadId: threadId === "worker" ? "middle" : threadId === "middle" ? "old" : null }));
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: unknown }) => {
    if (pluginId === "auto-effort" && !jevAvailable) throw new Error("Jev unavailable");
    if (pluginId === "auto-effort" && answered && "resolved0" in (input as { questions: object }).questions) return { answers: { resolved0: { noul: resolveScore } } };
    if (pluginId === "auto-effort") return { answers: { waiting: { noul: output.includes("?") ? 0.9 : 0 }, ask: { choice: output.includes("?") ? "s1" : "none" } } };
    expect(pluginId).toBe("orchestrator-mode");
    if (!available) throw new Error("RPC unavailable");
    if (method === "bot_roster") return { bots: [NEEDS_BOT] };
    if (method === "needs_list") return { items: items.filter(item => item.state === "open" || item.state === "snoozed" || item.state === "reminded") };
    if (method === "needs_add") {
      // Matches backend's strict RPC: CLI names, not a source object.
      const data = needsAddSchema.parse(input);
      let item = items.find(item => item.key === data.key && !["done", "dropped"].includes(item.state));
      if (!item) { item = makeNeed({ id: `need${items.length + 1}`, bot: data.bot, kind: data.kind, text: data.text, key: data.key ?? null, due: data.due ?? null, source: { ...(data.thread ? { threadId: data.thread } : {}), ...(data.message ? { messageId: data.message } : {}) } }); items.push(item); }
      return needsResultSchema.parse({ item });
    }
    if (method === "needs_update") {
      const data = input as { id: string; action: string; until: string };
      const item = items.find(item => item.id === data.id)!;
      item.state = data.action === "snooze" ? "snoozed" : data.action === "reopen" ? "open" : "done";
      item.snoozeUntil = data.until ?? null;
      return { item };
    }
    throw new Error(`Unexpected ${method}`);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: { plugins: { callRpc }, threads: { get, output: outputFn,
    interactions: { list: async () => [] }, events: { list: async () => answered ? [
      { seq: 6, createdAt: version, type: "item/completed", data: { item: { type: "agentMessage", text: output } } },
      { seq: 5, createdAt: version - 1, type: "client/turn/requested", data: { initiator: "user", input: [{ type: "text", text: "Approve it." }] } },
    ] : [] } } } as never });
  await plugin(bb); disposers.push(() => harness.lifecycle.dispose());
  const ask = (at = version || 1) => { version = at; return harness.behavior.callRpc("crew_asks", { threads: [{ threadId: "coord", version: at }] }) as Promise<{ judgements: { version: number; ask: string | null; itemId?: string | null; dismissed?: boolean }[] }>; };
  return { harness, items, callRpc, get, acknowledge: () => { version = NEEDS_NOW + 10; answered = true; output = "You approved it. Recorded your decision."; },
    setAvailable: (value: boolean) => { available = value; }, setJevAvailable: (value: boolean) => { jevAvailable = value; }, setOutput: (value: string) => { output = value; },
    setResolveScore: (value: number) => { resolveScore = value; }, ask, logs: (level: string) => harness.inspection.logEntries.filter(entry => entry.level === level).map(entry => entry.message) };
}
describe("Radar server needs bridge", () => {
  it("closes an answered saved decision at coordinator idle even when Crew is closed", async () => {
    const host = await setup(); await host.ask(); host.acknowledge();
    const result = await host.harness.behavior.emitThreadEvent("thread.idle", { thread: await host.get({ threadId: "coord" }), lastAssistantText: "You approved it. Recorded your decision." });
    expect(result.errors).toEqual([]);
    expect(host.items[0]?.state).toBe("done");
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [], seen: {} });
    expect(host.logs("info")).toContainEqual(expect.stringMatching(/^Needs You need1: answered decision closed .* version \d+, score 0\.99$/));
  });
  it("closes an answered decision as soon as a client reports the acknowledging reply", async () => {
    const host = await setup(); await host.ask(); host.acknowledge();
    expect(host.items[0]?.state).toBe("open");
    await host.ask(NEEDS_NOW + 10);
    await vi.waitFor(() => expect(host.items[0]?.state).toBe("done"));
    expect(host.callRpc.mock.calls.filter(([args]) => args.method === "needs_update")).toHaveLength(1);
    // The same version reported again, by another client, is not checked twice.
    await host.ask(NEEDS_NOW + 10);
    expect(host.callRpc.mock.calls.filter(([args]) => args.method === "needs_update")).toHaveLength(1);
  });
  it("marks a reply seen but not confirmed when the verdict is below the threshold, and logs the verdict", async () => {
    const host = await setup(); await host.ask(); host.acknowledge(); host.setResolveScore(0.6);
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [expect.objectContaining({ id: "need1", state: "open" })], seen: { need1: { version: NEEDS_NOW + 10, score: 0.6 } } });
    expect(host.logs("info")).toContainEqual(`Needs You need1: reply seen, not confirmed at version ${NEEDS_NOW + 10}, score 0.6, kept`);
  });
  it("logs a resolver failure with the item and retries later", async () => {
    const host = await setup(); await host.ask(); host.acknowledge(); host.setJevAvailable(false);
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [expect.objectContaining({ id: "need1", state: "open" })], seen: {} });
    expect(host.logs("warn")).toContainEqual("Needs You need1: check failed for coord, retry in 5 min: Jev unavailable");
    host.setJevAvailable(true);
    vi.spyOn(Date, "now").mockReturnValue(NEEDS_NOW + 5 * 60_000 + 1);
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [], seen: {} });
  });
  it("hides a missing backend and recovers without changing the contract", async () => {
    const host = await setup(); host.setAvailable(false);
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: null });
    host.setAvailable(true);
    expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [], seen: {} });
    expect(host.callRpc).toHaveBeenLastCalledWith(expect.objectContaining({ pluginId: "orchestrator-mode", method: "needs_list", input: { states: ["open", "snoozed", "reminded"] } }));
  });
  it("resolves descendant ownership and adds then snoozes with source message", async () => {
    const host = await setup();
    const input = { threadId: "worker", messageId: "m2", text: "Read this sentence", until: "2026-10-08T06:00:00Z" };
    await host.harness.behavior.callRpc("crew_remind", input);
    expect(host.items).toHaveLength(1);
    expect(host.items[0]).toMatchObject({ bot: "home", kind: "reminder", text: "Read this sentence", source: { threadId: "worker", messageId: "m2" }, state: "snoozed", snoozeUntil: input.until });
    expect(host.get.mock.calls.map(([args]) => args.threadId)).toEqual(["worker", "middle"]);
    await host.harness.behavior.callRpc("crew_remind", input);
    expect(host.items).toHaveLength(1);
    await host.harness.behavior.callRpc("crew_needs_update", { id: host.items[0]!.id, action: "done" });
    expect(host.items[0]?.state).toBe("done");
  });
  it("defaults unrelated threads to personal, follows lifecycle owners, and rejects past times", async () => {
    const host = await setup();
    const input = { threadId: "unrelated", messageId: "m", text: "Follow up", until: "2026-10-09T06:00:00Z" };
    await host.harness.behavior.callRpc("crew_remind", input);
    expect(host.items[0]?.bot).toBe("personal");
    host.get.mockImplementation(async ({ threadId }) => makeThreadResponse({ id: threadId, lifecycleOwnerThreadId: "coord" }));
    await host.harness.behavior.callRpc("crew_remind", { ...input, threadId: "lifecycle" });
    expect(host.items[1]?.bot).toBe("home");
    await expect(host.harness.behavior.callRpc("crew_remind", { ...input, until: "2020-01-01T00:00Z" })).rejects.toThrow();
    expect(host.items).toHaveLength(2);
  });
});
describe("judge captures asks durably", () => {
  it("adds once across concurrent/cached reads, retains old asks after a new reply, and saves a repeat after Done", async () => {
    const host = await setup();
    await Promise.all([host.ask(), host.ask()]); const { judgements: [judged] } = await host.ask();
    expect(host.items).toHaveLength(1);
    expect(host.items[0]).toMatchObject({ bot: "home", kind: "decision", text: "Should I approve the repair?", source: { threadId: "coord" } });
    expect(host.items[0]?.key).toMatch(/^coord:[0-9a-f]{24}$/);
    expect(judged).toMatchObject({ version: 1, ask: "Should I approve the repair?", itemId: "need1" });
    expect(host.callRpc.mock.calls.filter(([args]) => args.method === "needs_add")).toHaveLength(1);
    // Cache hits with a saved item never go back to the store.
    expect(host.callRpc.mock.calls.filter(([args]) => args.method === "bot_roster")).toHaveLength(1);
    host.setOutput("The inspection is finished. Nothing to do."); await host.ask(2);
    expect(host.items[0]?.state).toBe("open");
    // The same ask in a later reply reuses the open item.
    host.setOutput("Should I approve the repair? Still waiting."); const { judgements: [again] } = await host.ask(3);
    expect(again).toMatchObject({ version: 3, itemId: "need1" }); expect(host.items).toHaveLength(1);
    await host.harness.behavior.callRpc("crew_needs_update", { id: host.items[0]!.id, action: "done" });
    expect((await host.ask(3)).judgements[0]).toMatchObject({ version: 3, itemId: "need1", dismissed: true });
    host.setOutput("SHOULD I approve the repair?!"); const { judgements: [repeat] } = await host.ask(4);
    expect(host.items.map(item => item.state)).toEqual(["done", "open"]);
    expect(repeat).toMatchObject({ version: 4, ask: "SHOULD I approve the repair?!", itemId: "need2" });
    expect(repeat?.dismissed).toBeUndefined();
  });
  it("marks the judgement dismissed on Done so the bubble stays away, and clears it on Undo", async () => {
    const host = await setup(); await host.ask();
    await host.harness.behavior.callRpc("crew_needs_update", { id: "need1", action: "done" });
    expect((await host.ask()).judgements[0]).toMatchObject({ version: 1, itemId: "need1", dismissed: true });
    expect(host.logs("info")).toContain("Needs You need1: closed by Salem, ask dismissed for the current reply");
    await host.harness.behavior.callRpc("crew_needs_update", { id: "need1", action: "reopen" });
    expect((await host.ask()).judgements[0]).toMatchObject({ version: 1, itemId: "need1", dismissed: false });
    expect(host.callRpc.mock.calls.filter(([args]) => args.method === "jev_decide")).toHaveLength(1);
  });
  it("retries capture from the cached judgement after the backend comes back", async () => {
    const host = await setup(); host.setAvailable(false); await host.ask();
    expect(host.items).toHaveLength(0); expect((await host.ask()).judgements[0]?.itemId).toBeNull();
    expect(host.logs("warn")).toContainEqual("Needs You capture failed for coord at version 1: RPC unavailable");
    host.setAvailable(true); vi.spyOn(Date, "now").mockReturnValue(NEEDS_NOW + 5 * 60_000 + 1);
    expect((await host.ask()).judgements[0]?.itemId).toBe("need1");
    expect(host.items).toHaveLength(1);
  });
  it("captures explicit decisions when Jev is down, without duplicate prefix keys", async () => {
    const host = await setup(); host.setOutput("Decision needed: Approve the repair?");
    host.setJevAvailable(false);
    await host.ask();
    expect(host.items).toHaveLength(1);
    expect(host.items[0]?.text).toBe("Approve the repair?");
    host.setJevAvailable(true); await host.ask(2); expect(host.items).toHaveLength(1);
  });
});

it("captures only the explicit ask when Jev would choose a different sentence", async () => {
  const host = await setup();
  host.setOutput("Should I change the plan?\nDecision needed: Approve the repair?");
  await host.ask(); await host.ask();
  expect(host.items.map(item => item.text)).toEqual(["Approve the repair?"]);
  expect(host.callRpc.mock.calls.filter(([args]) => args.method === "needs_add")).toHaveLength(1);
  expect(host.callRpc.mock.calls.filter(([args]) => args.method === "jev_decide")).toHaveLength(0);
});
it.each(["open", "snoozed", "reminded"] as const)("skips an existing %s item with normalized text and another key/source", async state => {
  const host = await setup();
  host.items.push(makeNeed({ key: "automation:key", state, text: "**ＳＨＯＵＬＤ I**   approve the repair.", source: { automationId: "a" } }));
  await host.ask();
  expect(host.items).toHaveLength(1);
  expect(host.callRpc.mock.calls.filter(([args]) => args.method === "needs_add")).toHaveLength(0);
  expect(host.callRpc.mock.calls).toContainEqual([expect.objectContaining({ method: "needs_list", input: { bot: "home" } })]);
});
it("keeps a snoozed reminder visible through the server and supports Undo reopen", async () => {
  const host = await setup();
  await host.harness.behavior.callRpc("crew_remind", { threadId: "worker", messageId: "m", text: "Remember this", until: "2026-10-08T06:00Z" });
  expect(await host.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: host.items, seen: {} });
  const id = host.items[0]!.id;
  await host.harness.behavior.callRpc("crew_needs_update", { id, action: "done" });
  await host.harness.behavior.callRpc("crew_needs_update", { id, action: "reopen" });
  expect(host.items[0]?.state).toBe("open");
});
