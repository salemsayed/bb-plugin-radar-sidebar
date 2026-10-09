// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { needsAddSchema, type NeedsItem } from "./needs";
import { NEEDS_BOT, NEEDS_NOW, makeNeed } from "../components/radar/needsFixtures";
const disposers: (() => Promise<void>)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NEEDS_NOW); });
afterEach(async () => { for (const d of disposers.splice(0)) await d(); vi.restoreAllMocks(); });
async function setup() {
  const items: NeedsItem[] = []; let available = true;
  const get = vi.fn(async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId,
    parentThreadId: threadId === "worker" ? "middle" : threadId === "middle" ? "old" : null }));
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: any }) => {
    expect(pluginId).toBe("orchestrator-mode");
    if (!available) throw new Error("RPC unavailable");
    if (method === "bot_roster") return { bots: [NEEDS_BOT] };
    if (method === "needs_list") return { items: items.filter(i => (input?.states ?? ["open", "snoozed", "reminded"]).includes(i.state)) };
    if (method === "needs_add") {
      const d = needsAddSchema.parse(input);
      let item = items.find(i => i.key === d.key && !["done", "dropped"].includes(i.state));
      if (!item) { item = makeNeed({ id: `need${items.length + 1}`, bot: d.bot, kind: d.kind, text: d.text, key: d.key ?? null, due: d.due ?? null, source: { threadId: d.thread, messageId: d.message } }); items.push(item); }
      return { item };
    }
    if (method === "needs_update") {
      const item = items.find(i => i.id === input.id)!;
      item.state = input.action === "snooze" ? "snoozed" : input.action === "reopen" ? "open" : "done";
      item.snoozeUntil = input.until ?? null; return { item };
    }
    throw new Error(`Unexpected ${method}`);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: { plugins: { callRpc }, threads: { get,
    output: async () => ({ output: "Decision needed: approve the repair?" }), events: { list: async () => [] } } } as never });
  await plugin(bb); disposers.push(() => harness.lifecycle.dispose());
  const ask = (version = 1) => harness.behavior.callRpc("crew_asks", { threads: [{ threadId: "coord", version }] }) as Promise<{ judgements: any[] }>;
  return { items, harness, get, callRpc, ask, unavailable: (value: boolean) => { available = !value; } };
}
it("opening concurrent sidebars never extracts a question or calls a model", async () => {
  const h = await setup(); const replies = await Promise.all([h.ask(), h.ask(), h.ask(2)]);
  expect(replies.every(r => r.judgements[0].waiting === 0)).toBe(true); expect(h.items).toEqual([]);
  expect(h.callRpc.mock.calls.some(([a]) => a.method === "needs_add" || a.pluginId === "auto-effort")).toBe(false);
});
it("a bot's open decision on Needs You is its ask until someone closes or snoozes it", async () => {
  const h = await setup();
  h.items.push(makeNeed({ id: "remind", bot: "home", kind: "reminder", text: "Descale", source: { threadId: "coord" } }));
  expect((await h.ask()).judgements[0]).toMatchObject({ waiting: 0, ask: null });
  h.items.push(makeNeed({ id: "other", bot: "home", kind: "decision", text: "Older question", createdAt: "2026-10-01T00:00:00.000Z", source: {} }));
  h.items.push(makeNeed({ id: "repair", bot: "home", kind: "decision", text: "Approve the repair?", source: { threadId: "coord" } }));
  expect((await h.ask(2)).judgements[0]).toMatchObject({ waiting: 1, ask: "Approve the repair?", itemId: "repair" });
  await h.harness.behavior.callRpc("crew_needs_update", { id: "repair", action: "snooze", until: "2026-10-09T06:00Z" });
  expect((await h.ask(3)).judgements[0]).toMatchObject({ waiting: 1, ask: "Older question", itemId: "other" });
  await h.harness.behavior.callRpc("crew_needs_update", { id: "other", action: "done" });
  expect((await h.ask(4)).judgements[0]).toMatchObject({ waiting: 0, ask: null });
  expect(h.callRpc.mock.calls.some(([a]) => a.method === "needs_add")).toBe(false);
});
it("preserves historical asks until an explicit closure", async () => {
  const h = await setup(); h.items.push(makeNeed({ id: "old", bot: "home", kind: "decision", due: null, source: { threadId: "coord" } }));
  expect((await h.ask()).judgements[0].waiting).toBe(1); await h.harness.behavior.callRpc("crew_needs_list", {}); expect(h.items[0].state).toBe("open");
  await h.harness.behavior.callRpc("crew_needs_update", { id: "old", action: "done" }); expect((await h.ask(2)).judgements[0].waiting).toBe(0);
});
it("hides an unavailable source backend and recovers the same saved contract", async () => {
  const h = await setup(); h.unavailable(true); expect(await h.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: null });
  h.unavailable(false); expect(await h.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: [], seen: {} });
});
it("resolves descendant ownership, dedupes explicit reminders and preserves Undo", async () => {
  const h = await setup(); const input = { threadId: "worker", messageId: "m", text: "Follow up", until: "2026-10-09T06:00Z" };
  await h.harness.behavior.callRpc("crew_remind", input); await h.harness.behavior.callRpc("crew_remind", input);
  expect(h.items).toHaveLength(1); expect(h.items[0]).toMatchObject({ bot: "home", state: "snoozed", source: { threadId: "worker", messageId: "m" }, snoozeUntil: input.until });
  expect(await h.harness.behavior.callRpc("crew_needs_list", {})).toEqual({ items: h.items, seen: {} });
  await h.harness.behavior.callRpc("crew_needs_update", { id: "need1", action: "done" });
  await h.harness.behavior.callRpc("crew_needs_update", { id: "need1", action: "reopen" }); expect(h.items[0].state).toBe("open");
});
it("follows lifecycle ownership and rejects past reminder times", async () => {
  const h = await setup(); h.get.mockImplementation(async ({ threadId }) => makeThreadResponse({ id: threadId, lifecycleOwnerThreadId: "coord" }));
  await h.harness.behavior.callRpc("crew_remind", { threadId: "detached", messageId: "m", text: "Follow up", until: "2026-10-09T06:00Z" }); expect(h.items[0].bot).toBe("home");
  await expect(h.harness.behavior.callRpc("crew_remind", { threadId: "detached", messageId: "m", text: "Past", until: "2020-01-01T00:00Z" })).rejects.toThrow(); expect(h.items).toHaveLength(1);
});
