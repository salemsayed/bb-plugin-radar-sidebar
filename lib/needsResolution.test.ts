// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createNeedsResolver, capturedDecision, resolutionQuestions, seenMarkers } from "./needsResolution";
import { makeNeed, NEEDS_NOW } from "../components/radar/needsFixtures";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
type Event = { seq: number; createdAt: number; type?: string; data: { initiator?: string; systemMessageKind?: string;
  input?: { type: string; text: string }[]; item?: { type: string; text?: string; command?: string; parentToolCallId?: string } } };
const human = (seq: number, createdAt: number, text: string): Event => ({ seq, createdAt, type: "client/turn/requested",
  data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text }] } });
const coordinator = (seq: number, createdAt: number, text: string): Event => ({ seq, createdAt, type: "item/completed", data: { item: { type: "agentMessage", text } } });
async function setup() {
  const item = makeNeed({ key: `coord:${"a".repeat(24)}`, source: { threadId: "coord" }, due: null });
  const items = [item];
  let thread = makeThreadResponse({ id: "coord", latestAttentionAt: NEEDS_NOW });
  let events: Event[] = [human(5, NEEDS_NOW - 1000, "Yes, approve the repair."), coordinator(6, NEEDS_NOW, "You approved the repair. I have recorded your decision.")];
  let probability = 0.99;
  let unavailable = false;
  let race: (() => void) | undefined;
  let afterUpdate: (() => void) | undefined;
  let interactions: unknown[] = [];
  let now = NEEDS_NOW;
  let output = "You approved the repair. I have recorded your decision.";
  let lastJevInput: unknown;
  const eventCalls: { limit?: string; beforeSeq?: string }[] = [];
  const decide = vi.fn(async () => { if (unavailable) throw new Error("Jev unavailable"); race?.(); return { answers: Object.fromEntries(items.map((_, i) => [`resolved${i}`, { noul: probability }])) }; });
  const updates = vi.fn(async ({ id }: { id: string }) => { const found = items.find(item => item.id === id)!; found.state = "done"; afterUpdate?.(); return { item: found }; });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: {
    threads: { get: async () => thread, interactions: { list: async () => interactions }, events: { list: async (args: { limit?: string; beforeSeq?: string; order?: string; types?: string[] }) => {
      // Mirrors bb: at most 100 per page, newest first, `beforeSeq` pages back.
      const limit = Number(args.limit ?? 100);
      if (limit > 100) throw new Error("HTTP 400: Thread event limit cannot exceed 100");
      eventCalls.push(args);
      const sorted = [...events].filter(event => !event.type || args.types?.includes(event.type)).sort((a, b) => b.seq - a.seq)
        .filter(event => !args.beforeSeq || event.seq < Number(args.beforeSeq));
      return sorted.slice(0, limit) as never;
    } }, output: async () => ({ output }) },
    plugins: { callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input: unknown }) => {
      if (pluginId === "auto-effort") { lastJevInput = input; return decide(); }
      if (method === "needs_list") return { items: structuredClone(items.filter(item => item.state !== "done")) };
      if (method === "needs_update") return updates(input as { id: string });
      throw new Error(`Unexpected ${method}`);
    } },
  } as never });
  disposers.push(() => harness.lifecycle.dispose());
  const resolve = createNeedsResolver(bb, () => now);
  return { item, items, resolve, decide, updates, eventCalls, jevInput: () => lastJevInput as ReturnType<typeof resolutionQuestions>, seen: () => seenMarkers(bb, items), logs: (level: string) => harness.inspection.logEntries.filter(entry => entry.level === level).map(entry => entry.message),
    seedCache: (value: unknown) => bb.storage.kv.set("needs-resolution:coord", value),
    setAfterUpdate: (fn: () => void) => { afterUpdate = fn; }, setInteractions: (value: unknown[]) => { interactions = value; },
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
  it("sends at most eight questions and judges remaining asks on the next read", async () => {
    const h = await setup();
    for (let i = 2; i <= 10; i++) h.items.push(makeNeed({ ...h.item, id: `need${i}` }));
    h.setProbability(0.5);
    await h.resolve(h.items);
    expect(Object.keys(h.jevInput().questions)).toHaveLength(8);
    expect(h.jevInput().state.savedDecisions.map(item => item.id)).toEqual(h.items.slice(0, 8).map(item => item.id));
    h.setProbability(0.99);
    await h.resolve(h.items);
    expect(Object.keys(h.jevInput().questions)).toHaveLength(2);
    expect(h.jevInput().state.savedDecisions.map(item => item.id)).toEqual(["need9", "need10"]);
    expect(h.items.slice(0, 8).every(item => item.state === "open")).toBe(true);
    expect(h.items.slice(8).every(item => item.state === "done")).toBe(true);
    await h.resolve(h.items);
    expect(h.decide).toHaveBeenCalledTimes(2);
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
  it("judges an answer against the acknowledgment that followed it, not only the latest unrelated reply", async () => {
    const h = await setup();
    h.setEvents([
      { seq: 5, createdAt: NEEDS_NOW - 3000, data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text: "yes, start the pilot and benchmark it" }] } },
      { seq: 6, createdAt: NEEDS_NOW - 2000, type: "item/completed", data: { item: { type: "agentMessage", text: "Pilot worker started with the benchmark." } } } as never,
      { seq: 7, createdAt: NEEDS_NOW - 1000, type: "item/completed", data: { item: { type: "agentMessage", text: "The git-repair worker failed on a 529; restarted it." } } } as never,
    ]);
    h.setOutput("The git-repair worker failed on a 529; restarted it.");
    await h.resolve(h.items);
    expect(h.item.state).toBe("done");
    expect(h.jevInput().state.conversation.map(turn => turn.role)).toEqual(["salem", "coordinator", "coordinator"]);
    expect(h.jevInput().state.conversation[1]!.text).toBe("Pilot worker started with the benchmark.");
  });
  it("pages events back in 100-event pages and keeps the answer and acknowledgment from an older page", async () => {
    const h = await setup();
    const noise = Array.from({ length: 150 }, (_, i) => ({ seq: 10 + i, createdAt: NEEDS_NOW - 1500 + i, type: "item/completed",
      data: { item: { type: "commandExecution", command: `ls ${i}` } } }) as never);
    const chatter = Array.from({ length: 40 }, (_, i) => ({ seq: 200 + i, createdAt: NEEDS_NOW - 1000 + i, type: "item/completed",
      data: { item: { type: "agentMessage", text: `Progress note ${i}.` } } }) as never);
    h.setEvents([
      { seq: 5, createdAt: NEEDS_NOW - 3000, data: { initiator: "user", systemMessageKind: "unlabeled", input: [{ type: "text", text: "yes, start the pilot" }] } },
      { seq: 6, createdAt: NEEDS_NOW - 2000, type: "item/completed", data: { item: { type: "agentMessage", text: "Pilot worker started." } } } as never,
      ...noise, ...chatter,
    ]);
    h.setOutput("Progress note 39.");
    await h.resolve(h.items);
    expect(h.eventCalls.length).toBeGreaterThan(1);
    expect(h.eventCalls.every(call => Number(call.limit) <= 100)).toBe(true);
    const roles = h.jevInput().state.conversation.map(turn => `${turn.role}:${turn.text}`);
    expect(roles[0]).toBe("salem:yes, start the pilot");
    expect(roles[1]).toBe("coordinator:Pilot worker started.");
    expect(roles.at(-1)).toBe("coordinator:Progress note 39.");
    expect(h.jevInput().state.conversation.length).toBe(42);
    expect(new TextEncoder().encode(JSON.stringify(h.jevInput())).length).toBeLessThanOrEqual(96 * 1024);
    expect(h.item.state).toBe("done");
  });
  it("keeps a delayed answer and later acknowledgment between old progress and a long tail", async () => {
    const h = await setup();
    const at = Date.parse(h.item.createdAt);
    h.setEvents([
      coordinator(1, at - 1, "Shall I start the repair pilot with benchmarks?"),
      ...Array.from({ length: 10 }, (_, i) => coordinator(2 + i, at + 1 + i, `Earlier unrelated progress ${i}.`)),
      human(12, at + 100, "Yes, make sure to benchmark and cover your bases."),
      ...Array.from({ length: 10 }, (_, i) => coordinator(13 + i, at + 101 + i, `Checking prerequisites ${i}.`)),
      coordinator(23, at + 200, "Pilot worker started with benchmarks."),
      ...Array.from({ length: 30 }, (_, i) => coordinator(24 + i, at + 300 + i, `Later unrelated progress ${i}.`)),
    ]);
    await h.resolve(h.items);
    const turns = h.jevInput().state.conversation;
    expect(turns.find(turn => turn.seq === 1)?.text).toContain("Shall I start");
    expect(turns.find(turn => turn.seq === 12)?.text).toContain("benchmark");
    expect(turns.find(turn => turn.seq === 23)?.text).toContain("Pilot worker started");
    expect(h.item.state).toBe("done");
  });
  it("pages beyond a card timestamp to retain the original coordinator question", async () => {
    const h = await setup();
    const at = Date.parse(h.item.createdAt);
    h.setEvents([
      coordinator(1, at - 97, "Shall I start the pilot?"),
      { seq: 2, createdAt: at - 1, type: "item/completed", data: { item: { type: "commandExecution", command: "true" } } },
      human(3, at + 1, "yes"), coordinator(4, at + 2, "Pilot started."),
      ...Array.from({ length: 97 }, (_, i) => coordinator(5 + i, at + 3 + i, `Progress ${i}.`)),
    ]);
    await h.resolve(h.items);
    expect(h.eventCalls).toHaveLength(2);
    expect(h.eventCalls[1]?.beforeSeq).toBe("2");
    expect(h.jevInput().state.conversation[0]?.seq).toBe(1);
    expect(h.item.state).toBe("done");
  });
  it.each(["conversation-v1", "conversation-v2"])("rejudges %s negative evidence once at the same reply version", async evidence => {
    const h = await setup();
    await h.seedCache({ evidence, version: NEEDS_NOW, checked: [h.item.id], seen: { [h.item.id]: 0.49 } });
    await h.resolve(h.items);
    expect(h.decide).toHaveBeenCalledOnce(); expect(h.item.state).toBe("done");
    h.item.state = "open";
    await h.resolve(h.items);
    expect(h.decide).toHaveBeenCalledOnce(); expect(h.item.state).toBe("open");
  });
  it.each([undefined, "conversation-v1", "conversation-v2"])("preserves same-version Undo when migrating %s evidence", async evidence => {
    const h = await setup();
    await h.seedCache({ evidence, version: NEEDS_NOW, checked: [h.item.id], seen: {} });
    await h.resolve(h.items);
    expect(h.decide).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
  });
  it("preserves migrated Undo protection when other decisions are rejudged", async () => {
    const h = await setup();
    h.items.push(makeNeed({ ...h.item, id: "need2" }));
    await h.seedCache({ evidence: "conversation-v1", version: NEEDS_NOW, checked: [h.item.id, "need2"], seen: { need2: 0.39 } });
    await h.resolve(h.items); await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(h.items[1]?.state).toBe("done");
    expect(h.decide).toHaveBeenCalledOnce();
  });
  it("requires a sequenced coordinator acknowledgment after the human reply even on a confident verdict", async () => {
    const h = await setup();
    h.setEvents([coordinator(1, NEEDS_NOW - 2000, "Decision recorded."), human(2, NEEDS_NOW - 1000, "yes")]);
    await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(h.updates).not.toHaveBeenCalled();
  });
  it("does not treat nested worker messages as a coordinator acknowledgment", async () => {
    const h = await setup();
    const worker = coordinator(2, NEEDS_NOW, "Pilot started."); worker.data.item!.parentToolCallId = "worker-task";
    h.setEvents([human(1, NEEDS_NOW - 1, "yes"), worker]);
    await h.resolve(h.items);
    expect(h.jevInput().state.conversation.map(turn => turn.role)).toEqual(["salem"]);
    expect(h.item.state).toBe("open"); expect(h.updates).not.toHaveBeenCalled();
  });
  it("requires a later answer separately for each candidate", async () => {
    const h = await setup();
    h.items.push(makeNeed({ ...h.item, id: "need2", createdAt: new Date(NEEDS_NOW - 500).toISOString() }));
    await h.resolve(h.items);
    expect(h.item.state).toBe("done"); expect(h.items[1]?.state).toBe("open");
  });
  it("keeps a newer push request pending until its own later answer while settling an older deferred decision", async () => {
    const h = await setup();
    const at = Date.parse(h.item.createdAt);
    h.item.text = "Want me to spawn that v2 planning worker alongside the pilot?";
    const push = makeNeed({ ...h.item, id: "push", text: "Force-push the repair and post the MR reply?", createdAt: new Date(at + 400).toISOString() });
    h.items.push(push);
    const events = [
      coordinator(1, at - 1, h.item.text),
      human(2, at + 100, "Is products first the logical order?"),
      coordinator(3, at + 200, "Products first. Want me to also spawn the v2 planning worker in parallel, plan only?"),
      human(4, at + 300, "no, we finish this first, with benchmarks and review and all, we send it upstream and mention this sequence and we wait"),
      coordinator(5, at + 350, "Plan set: finish pilot, Astra review, send upstream with the sequence, then wait. V2 is later."),
      coordinator(6, at + 399, push.text),
    ];
    h.setEvents(events);
    h.setOutput(push.text);
    await h.resolve(h.items);
    // The stubbed positive verdict exercises per-card gates, not Jev's semantic accuracy.
    expect(h.item.state).toBe("done"); expect(push.state).toBe("open");
    expect(h.updates).toHaveBeenCalledTimes(1);
    const questions = h.jevInput().questions;
    expect(questions.resolved0?.instructions).toContain("savedDecisions[0]");
    expect(questions.resolved1?.instructions).toContain("savedDecisions[1]");
    expect(questions.resolved1?.criteria.false).toContain("needs its own answer after it was saved");
    const acknowledgment = "Pushing the repair and posting its MR reply now.";
    h.setEvents([...events, human(7, at + 500, "Go, force-push that repair and post the MR reply."), coordinator(8, at + 600, acknowledgment)]);
    h.setOutput(acknowledgment); h.setThread({ latestAttentionAt: NEEDS_NOW + 1 });
    await h.resolve(h.items);
    expect(h.item.state).toBe("done"); expect(push.state).toBe("done");
    expect(h.updates).toHaveBeenCalledTimes(2);
    expect(h.updates.mock.calls.map(([input]) => input.id)).toEqual([h.item.id, push.id]);
  });
  it("rechecks Snooze for each close after an earlier close yields", async () => {
    const h = await setup();
    const second = makeNeed({ ...h.item, id: "need2" }); h.items.push(second);
    h.setAfterUpdate(() => { second.state = "snoozed"; second.snoozeUntil = "2026-10-09T06:00Z"; });
    await h.resolve(h.items);
    expect(h.item.state).toBe("done"); expect(second.state).toBe("snoozed"); expect(h.updates).toHaveBeenCalledOnce();
  });
  it("stops a batch when new work begins and retries only its unprocessed decisions", async () => {
    const h = await setup();
    const second = makeNeed({ ...h.item, id: "need2" }); h.items.push(second);
    h.setAfterUpdate(() => h.setThread({ status: "active" }));
    await h.resolve(h.items);
    expect(h.item.state).toBe("done"); expect(second.state).toBe("open"); expect(h.updates).toHaveBeenCalledOnce();
    h.item.state = "open"; // Undo the first close while the second is still pending.
    h.setThread({ status: "idle" }); h.setAfterUpdate(() => {});
    await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(second.state).toBe("done"); expect(h.updates).toHaveBeenCalledTimes(2);
  });
  it("retains Undo protection when a later close loses its RPC response", async () => {
    const h = await setup();
    h.items.push(makeNeed({ ...h.item, id: "need2" }));
    let calls = 0;
    h.setAfterUpdate(() => { if (++calls === 2) { h.item.state = "open"; throw new Error("lost response"); } });
    await h.resolve(h.items);
    h.tick(); await h.resolve(h.items);
    expect(h.item.state).toBe("open"); expect(h.updates).toHaveBeenCalledTimes(2);
  });
  it.each([[0.79, "open"], [0.8, "done"]])("applies the confidence boundary at %s", async (score, state) => {
    const h = await setup(); h.setProbability(Number(score));
    await h.resolve(h.items); expect(h.item.state).toBe(state);
  });
  it("retains qualifications and acknowledgments beyond the previous per-message clipping limits", async () => {
    const h = await setup(); h.setProbability(0.3);
    const reply = `${"Explanation ".repeat(200)}No, defer v2 until the pilot is reviewed.`;
    const acknowledgment = `${"Details ".repeat(250)}Recorded: pilot, review, upstream, then wait.`;
    h.setEvents([human(1, NEEDS_NOW - 1, reply), coordinator(2, NEEDS_NOW, acknowledgment)]);
    await h.resolve(h.items);
    expect(h.jevInput().state.userReplies[0]?.text).toBe(reply);
    expect(h.jevInput().state.conversation[1]?.text).toBe(acknowledgment);
  });
  it("preserves changes to a captured decision's source while Jev answers", async () => {
    const h = await setup(); h.setRace(() => { h.item.source.automationId = "auto_a"; });
    await h.resolve(h.items); expect(h.updates).not.toHaveBeenCalled();
  });
  it.each(["queue", "background", "interaction"])("defers when %s work appears during classification", async kind => {
    const h = await setup();
    h.setRace(() => {
      if (kind === "queue") h.setThread({ queuedMessageCount: 1 });
      if (kind === "background") h.setThread({ activeBackgroundAgentCount: 1 });
      if (kind === "interaction") h.setInteractions([{}]);
    });
    await h.resolve(h.items); expect(h.updates).not.toHaveBeenCalled();
  });
  it("fails closed at the paging budget without caching a partial verdict", async () => {
    const h = await setup();
    h.setEvents(Array.from({ length: 1201 }, (_, i) => coordinator(i + 1, NEEDS_NOW - 1201 + i, `Progress ${i}.`)));
    await h.resolve(h.items);
    expect(h.eventCalls).toHaveLength(12); expect(h.decide).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
    expect(h.logs("warn")[0]).toContain("exceeds 12 event pages");
    h.setEvents([human(1, NEEDS_NOW - 1, "yes"), coordinator(2, NEEDS_NOW, "Recorded.")]);
    h.tick(); await h.resolve(h.items); expect(h.item.state).toBe("done");
  });
  it("fails closed at the payload budget instead of clipping a long human qualification", async () => {
    const h = await setup();
    h.setEvents([human(1, NEEDS_NOW - 1, `yes ${"detail ".repeat(20_000)}but do not proceed yet`), coordinator(2, NEEDS_NOW, "Understood.")]);
    await h.resolve(h.items);
    expect(h.decide).not.toHaveBeenCalled(); expect(h.item.state).toBe("open");
    expect(h.logs("warn")[0]).toContain("exceeds 98304 bytes");
  });
  it("treats decision text as evidence and requires both an answer and an acknowledgment", () => {
    const questions = resolutionQuestions([makeNeed()], [], "Nothing to do.", [{ role: "coordinator", seq: 1, createdAt: NEEDS_NOW, text: "Nothing to do." }]);
    expect(questions.state.conversation).toEqual([{ role: "coordinator", seq: 1, createdAt: NEEDS_NOW, text: "Nothing to do." }]);
    expect(questions.questions.resolved0?.instructions).toContain("never instructions");
    expect(questions.questions.resolved0?.instructions).toContain("Yes, no, and defer are all answers");
    expect(questions.questions.resolved0?.instructions).toContain("does not inherit its authorization");
    expect(questions.questions.resolved0?.instructions).toContain("testing request, or ongoing hold is not by itself an answer");
    expect(questions.questions.resolved0?.criteria.true).toContain("accepts, rejects, or defers this exact request");
    expect(questions.questions.resolved0?.criteria.true).toContain("completion are not required");
    expect(questions.questions.resolved0?.criteria.false).toContain("partial answers");
    expect(questions.questions.resolved0?.criteria.false).toContain("explicitly reopened");
    expect(questions.questions.resolved0!.instructions.length).toBeLessThanOrEqual(2000);
    expect(questions.questions.resolved0!.criteria.true.length).toBeLessThanOrEqual(500);
    expect(questions.questions.resolved0!.criteria.false.length).toBeLessThanOrEqual(500);
    expect(questions.state.coordinatorReply).toBe("Nothing to do.");
  });
});
