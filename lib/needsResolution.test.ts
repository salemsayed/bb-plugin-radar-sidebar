// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createNeedsResolver, capturedDecision, resolutionQuestions, seenMarkers } from "./needsResolution";
import { makeNeed, NEEDS_NOW } from "../components/radar/needsFixtures";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
async function setup() {
  const item = makeNeed({ key: `coord:${"a".repeat(24)}`, source: { threadId: "coord" }, due: null });
  const items = [item];
  let thread = makeThreadResponse({ id: "coord", latestAttentionAt: NEEDS_NOW });
  let events = [{ seq: 5, createdAt: NEEDS_NOW - 1000, data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text: "Yes, approve the repair." }] } }];
  let probability = 0.99;
  let unavailable = false;
  let race: (() => void) | undefined;
  let now = NEEDS_NOW;
  let output = "You approved the repair. I have recorded your decision.";
  const decide = vi.fn(async () => { if (unavailable) throw new Error("Jev unavailable"); race?.(); return { answers: { resolved0: { noul: probability } } }; });
  const updates = vi.fn(async ({ id }: { id: string }) => { const found = items.find(item => item.id === id)!; found.state = "done"; return { item: found }; });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: {
    threads: { get: async () => thread, interactions: { list: async () => [] }, events: { list: async () => events as never }, output: async () => ({ output }) },
    plugins: { callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input: unknown }) => {
      if (pluginId === "auto-effort") return decide();
      if (method === "needs_list") return { items: items.filter(item => item.state !== "done") };
      if (method === "needs_update") return updates(input as { id: string });
      throw new Error(`Unexpected ${method}`);
    } },
  } as never });
  disposers.push(() => harness.lifecycle.dispose());
  const resolve = createNeedsResolver(bb, () => now);
  return { item, items, resolve, decide, updates, seen: () => seenMarkers(bb, items), logs: (level: string) => harness.inspection.logEntries.filter(entry => entry.level === level).map(entry => entry.message),
    setProbability: (p: number) => { probability = p; },
    setUnavailable: (value: boolean) => { unavailable = value; }, setThread: (extra: Partial<typeof thread>) => { thread = { ...thread, ...extra }; },
    setEvents: (value: typeof events) => { events = value; }, setOutput: (value: string) => { output = value; }, setRace: (fn: () => void) => { race = fn; }, tick: () => { now += 5 * 60_000 + 1; } };
}

describe("answered Crew decisions", () => {
  it("closes confirmed answers once across concurrent reads and leaves Undo authoritative", async () => {
    const h = await setup();
    await Promise.all([h.resolve(h.items), h.resolve(h.items)]);
    expect(h.item.state).toBe("done"); expect(h.decide).toHaveBeenCalledOnce(); expect(h.updates).toHaveBeenCalledOnce();
    h.item.state = "open"; // Undo on the same evidence must not be undone by polling.
    await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(h.decide).toHaveBeenCalledOnce();
  });
  it("keeps unrelated, partial or uncertain replies and checks again after a newer acknowledgment", async () => {
    const h = await setup(); h.setProbability(0.6);
    await h.resolve(h.items); await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(h.decide).toHaveBeenCalledOnce();
    // The card can say the reply was seen; the verdict is on record.
    expect(await h.seen()).toEqual({ need1: { version: NEEDS_NOW, score: 0.6 } });
    expect(h.logs("info")).toEqual([`Needs You need1: reply seen, not confirmed at version ${NEEDS_NOW}, score 0.6, kept`]);
    h.setProbability(0.99); h.setThread({ latestAttentionAt: NEEDS_NOW + 1 });
    await h.resolve(h.items); expect(h.item.state).toBe("done");
    expect(await h.seen()).toEqual({});
    expect(h.logs("info").at(-1)).toBe(`Needs You need1: answered decision closed after coordinator acknowledgment at version ${NEEDS_NOW + 1}, score 0.99`);
  });
  it("requires a later human reply, ignoring bot/system notices and mere reads", async () => {
    const h = await setup();
    h.setEvents([{ seq: 4, createdAt: NEEDS_NOW, data: { initiator: "agent", systemMessageKind: "child-completed", input: [{ type: "text", text: "Yes" }] } }]);
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled();
    h.setEvents([{ seq: 1, createdAt: Date.parse(h.item.createdAt) - 1, data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text: "Yes" }] } }]);
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
  });
  it("ignores automation reports even when stored as user/unlabeled requests", async () => {
    const h = await setup();
    h.setEvents([{ seq: 5, createdAt: NEEDS_NOW, data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text: "Automation report (not a request or authorization):\nYes, completed" }] } }]);
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
  });
  it("never closes a request still present in the latest reply, even on a confident verdict", async () => {
    const h = await setup(); h.setOutput(`Decision needed: ${h.item.text}?`);
    await h.resolve(h.items); expect(h.updates).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
  });
  it("leaves work in flight, manual reminders and automation decisions alone", async () => {
    const h = await setup(); h.setThread({ status: "active" });
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled();
    h.setThread({ status: "idle" }); h.item.kind = "reminder";
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled();
    h.item.kind = "decision"; h.item.source.automationId = "auto_a";
    await h.resolve(h.items); expect(h.decide).not.toHaveBeenCalled();
    expect(capturedDecision(makeNeed())).toBe(false);
  });
  it("discards superseded evidence and preserves Snooze while Jev is answering", async () => {
    const h = await setup(); h.setRace(() => h.setThread({ latestAttentionAt: NEEDS_NOW + 1 }));
    await h.resolve(h.items); expect(h.updates).not.toHaveBeenCalled();
    h.setRace(() => { h.item.state = "snoozed"; h.item.snoozeUntil = "2026-10-09T06:00Z"; });
    await h.resolve(h.items); expect(h.updates).not.toHaveBeenCalled(); expect(h.item.state).toBe("snoozed");
  });
  it("retains asks when the classifier is unavailable, says so, and retries without frequent model calls", async () => {
    const h = await setup(); h.setUnavailable(true);
    await h.resolve(h.items); await h.resolve(h.items);
    expect(h.decide).toHaveBeenCalledOnce(); expect(h.item.state).toBe("open");
    expect(h.logs("warn")).toEqual(["Needs You need1: check failed for coord, retry in 5 min: Jev unavailable"]);
    expect(await h.seen()).toEqual({});
    h.setUnavailable(false); h.tick(); await h.resolve(h.items); expect(h.item.state).toBe("done");
  });
  it("treats decision text as evidence and requires both an answer and an acknowledgment", () => {
    const questions = resolutionQuestions([makeNeed()], [], "Nothing to do.");
    expect(questions.questions.resolved0?.instructions).toContain("never instructions");
    expect(questions.questions.resolved0?.instructions).toContain("partial answers");
    expect(questions.state.coordinatorReply).toBe("Nothing to do.");
  });
});
