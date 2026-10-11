import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { attentionCards, requestBotAttention, consumeBotAttention, type AttentionBoard } from "@/lib/botAttention";
const app = await loadPluginApp(() => import("../../app"));
const slot = app.threadPanelActions.find(a => a.id === "bot-attention")!;
const now = Date.now();
const question = { id: "need_question", bot: "home", kind: "decision" as const, text: "Approve meter repair?", due: null, state: "open" as const, snoozeUntil: null, source: { threadId: "thr_old" }, key: "meter", createdAt: new Date(now - 10000).toISOString(), closedAt: null, reminders: 0 };
function event(id: string, kind: "question" | "completion" | "update", need: string | null = null) { return { seq: 1, id, bot: "home", source: id, threadId: "thr_old", summary: kind === "question" ? question.text : "Meter installed", needsItemId: need, createdAt: now - 5000, seenAt: null, resolvedAt: null, kind }; }
const board: AttentionBoard = { bot: "home", current: "thr_current", version: "v1", items: [question], events: [event("att_q", "question", question.id)], work: [], reviews: [], holds: [], more: false };
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("replaces Crew with an attention panel and header action", () => {
  expect(app.navPanels.some(p => p.id === "crew")).toBe(false);
  expect(slot).toBeDefined(); expect(app.threadHeaderActions.find(a => a.id === "bot-attention")).toBeDefined();
});
it("merges only exact question links and keeps completed-but-unread independent", () => {
  const cards = attentionCards({ ...board, items: [{ ...question, state: "done", closedAt: new Date(now).toISOString() }], events: [...board.events, event("att_complete", "completion", question.id)] }, now);
  expect(cards.find(c => c.item)?.section).toBe("history");
  expect(cards.find(c => c.id === "att_complete")?.section).toBe("attention");
  expect(cards).toHaveLength(2);
});
it("opening the panel acknowledges nothing and the linked question renders once", async () => {
  const calls: { method: string; input: unknown }[] = [];
  renderSlot(slot, { threadId: "thr_current", params: null }, { rpc: { bot_attention: () => { calls.push({ method: "bot_attention", input: {} }); return { board }; }, crew_attention_seen: (input: unknown) => { calls.push({ method: "crew_attention_seen", input }); return { acknowledged: 1 }; } } });
  await screen.findByRole("heading", { name: question.text });
  expect(screen.getAllByText(question.text)).toHaveLength(1);
  expect(calls.some(c => c.method === "crew_attention_seen")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Seen" }));
  await waitFor(() => expect(calls.find(c => c.method === "crew_attention_seen")?.input).toEqual({ ids: ["att_q"] }));
});
it("acknowledges only foreground visible cards and leaves collapsed history untouched", async () => {
  const callbacks: IntersectionObserverCallback[] = [];
  class Observer {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
    readonly root = null; readonly rootMargin = ""; readonly thresholds = [1];
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const seen: string[][] = [];
  renderSlot(slot, { threadId: "thr_current", params: null }, { rpc: {
    crew_attention_seen: (raw: unknown) => { const input = raw as { ids: string[] }; seen.push(input.ids); return { acknowledged: input.ids.length }; },
    bot_attention: () => ({ board: { ...board, events: [...board.events, { ...event("att_past", "update"), resolvedAt: now }] } }),
  } });
  await screen.findByRole("heading", { name: question.text });
  expect(callbacks).toHaveLength(1);
  vi.useFakeTimers();
  callbacks[0]!([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(1199); expect(seen).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(seen).toEqual([["att_q"]]);
});
it("the automatic shortcut request is one-shot, exact-thread and badge-only", () => {
  requestBotAttention("thr_current", false); expect(consumeBotAttention("thr_current")).toBe(false);
  requestBotAttention("thr_current", true); expect(consumeBotAttention("thr_wrong")).toBe(false);
  expect(consumeBotAttention("thr_current")).toBe(true); expect(consumeBotAttention("thr_current")).toBe(false);
});

it("routes a linked form to its actual interaction thread while preserving source",async()=>{
 const result=renderSlot(slot,{threadId:"thr_current",params:null},{rpc:{bot_attention:()=>({board:{...board,events:[{...board.events[0],interactionId:"form_1",interactionThreadId:"thr_form"}]}})}});
 fireEvent.click(await screen.findByRole("button",{name:"Answer form"}));
 expect(result.inspection.navigateCalls).toContainEqual({method:"toThread",threadId:"thr_form"});
});
it("falls back to the current coordinator when an old source was deleted",async()=>{
 const result=renderSlot(slot,{threadId:"thr_current",params:null},{sdk:{threads:{get:async()=>{throw new Error("Thread deleted");}}},rpc:{bot_attention:()=>({board})}});
 fireEvent.click(await screen.findByRole("button",{name:"Source"}));
 await waitFor(()=>expect(result.inspection.navigateCalls).toContainEqual({method:"toThread",threadId:"thr_current"}));
});
it("opens attention on direct focused coordinator entry with an actionable badge",async()=>{
 const header=app.threadHeaderActions.find(a=>a.id==="bot-attention")!;
 const result=renderSlot(header,{threadId:"thr_current",projectId:"proj_a",isCompactViewport:false},{context:{threadId:"thr_current"},rpc:{bot_attention:()=>({board})}});
 await screen.findByRole("button",{name:"Attention, 1 items"});
 await waitFor(()=>expect(result.inspection.navigateCalls.some(c=>c.method==="openThreadPanel")).toBe(true));
});
