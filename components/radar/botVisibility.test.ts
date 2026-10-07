import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askingBotKeys, botDemandsAttention, hideBot, resetHiddenBots, unhideBot, useVisibleBots } from "./botVisibility";
import { makeThread } from "./fixtures";
import type { Pulse, RosterBot } from "./bots";
import type { CrewJudgement } from "@/lib/crewAsk";
import type { NeedsItem } from "@/lib/needs";
import { makeNeed } from "./needsFixtures";

const personal: RosterBot = { key: "personal", name: "Personal Bot", current: "p-root", projectId: "a", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const home: RosterBot = { ...personal, key: "home", name: "Home Bot", current: "h-root" };
const roster = [personal, home];

beforeEach(() => resetHiddenBots());
afterEach(() => { cleanup(); resetHiddenBots(); });

describe("hidden bots", () => {
  it("hides and unhides a bot, remembering the choice in localStorage", () => {
    const threads = [makeThread({ id: "p-root" }), makeThread({ id: "h-root" })];
    const { result } = renderHook(() => useVisibleBots(roster, threads));
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    act(() => result.current.hide("home"));
    expect(result.current.bots.map(b => b.key)).toEqual(["personal"]);
    expect(result.current.hiddenBots.map(b => b.key)).toEqual(["home"]);
    expect(result.current.isHidden("home")).toBe(true);
    expect(JSON.parse(localStorage.getItem("radar-sidebar:hidden-bots:v1") ?? "[]")).toEqual(["home"]);
    act(() => result.current.unhide("home"));
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    expect(localStorage.getItem("radar-sidebar:hidden-bots:v1")).toBeNull();
  });
  it("never hides an unread failure or a pending question, then hides again once quiet", () => {
    hideBot("home");
    const quiet = [makeThread({ id: "p-root" }), makeThread({ id: "h-root" }), makeThread({ id: "h-worker", parentThreadId: "h-root" })];
    const { result, rerender } = renderHook(({ threads }) => useVisibleBots(roster, threads), { initialProps: { threads: quiet } });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal"]);
    rerender({ threads: [quiet[0]!, quiet[1]!, { ...quiet[2]!, hasPendingInteraction: true }] });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    expect(result.current.hiddenBots).toEqual([]);
    expect(result.current.isHidden("home")).toBe(true);
    rerender({ threads: [quiet[0]!, quiet[1]!, { ...quiet[2]!, status: "error", isUnread: true }] });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    expect(result.current.isProtected("home")).toBe(true);
    rerender({ threads: [quiet[0]!, { ...quiet[1]!, indicator: "waiting-for-input" }, quiet[2]!] });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    // Hidden helpers and unrelated failures do not surface it.
    rerender({ threads: [quiet[0]!, quiet[1]!, { ...quiet[2]!, status: "error", isUnread: true, isHidden: true }, makeThread({ id: "stray", status: "error", isUnread: true })] });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal"]);
    expect(result.current.isProtected("home")).toBe(false);
    act(() => unhideBot("home"));
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
  });
  it("lets a bot with a read failure hide, and surfaces it only while the failure is unread or waiting", () => {
    // bb never clears status "error" or queuedWork "failed" on read, so a read
    // failure must not pin a hidden bot in view forever.
    const root = makeThread({ id: "h-root" });
    const readFailure = makeThread({ id: "h-worker", parentThreadId: "h-root", status: "error", isUnread: false });
    const readQueueFailure = { ...readFailure, status: "idle" as const, queuedWork: "failed" as const };
    expect(botDemandsAttention([root, readFailure], home)).toBe(false);
    expect(botDemandsAttention([root, readQueueFailure], home)).toBe(false);
    expect(botDemandsAttention([root, { ...readFailure, isUnread: true }], home)).toBe(true);
    expect(botDemandsAttention([root, { ...readQueueFailure, isUnread: true }], home)).toBe(true);
    expect(botDemandsAttention([root, { ...readFailure, indicator: "unread-error" }], home)).toBe(false);
    expect(botDemandsAttention([root, { ...readFailure, indicator: "unread-error", isUnread: true }], home)).toBe(true);
    expect(botDemandsAttention([root, { ...readFailure, hasPendingInteraction: true }], home)).toBe(true);
    expect(botDemandsAttention([{ ...root, status: "error", isUnread: false }], home)).toBe(false);

    const { result, rerender } = renderHook(({ threads }) => useVisibleBots(roster, threads), { initialProps: { threads: [makeThread({ id: "p-root" }), root, { ...readFailure, isUnread: true }] } });
    expect(result.current.isProtected("home")).toBe(true);
    act(() => result.current.hide("home"));
    // Hidden, but the unread failure keeps it in view.
    expect(result.current.bots.map(b => b.key)).toEqual(["personal", "home"]);
    expect(result.current.isHidden("home")).toBe(true);
    // Reading the failure lets the choice take effect.
    rerender({ threads: [makeThread({ id: "p-root" }), root, readFailure] });
    expect(result.current.bots.map(b => b.key)).toEqual(["personal"]);
    expect(result.current.hiddenBots.map(b => b.key)).toEqual(["home"]);
    expect(result.current.isProtected("home")).toBe(false);
  });
  it("lets reading a queued-failed indicator restore the hide preference", () => {
    hideBot("home");
    const root = makeThread({ id: "h-root" });
    const failure = makeThread({ id: "h-worker", parentThreadId: "h-root", queuedWork: "failed", indicator: "queued-failed", isUnread: true });
    const { result, rerender } = renderHook(({ worker }) => useVisibleBots(roster, [root, worker]), { initialProps: { worker: failure } });
    expect(result.current.isProtected("home")).toBe(true);
    expect(result.current.bots.map(bot => bot.key)).toContain("home");
    rerender({ worker: { ...failure, isUnread: false } });
    expect(result.current.isProtected("home")).toBe(false);
    expect(result.current.hiddenBots.map(bot => bot.key)).toEqual(["home"]);
    rerender({ worker: { ...failure, isUnread: false, hasPendingInteraction: true } });
    expect(result.current.isProtected("home")).toBe(true);
    expect(result.current.bots.map(bot => bot.key)).toContain("home");
  });
  it("survives a corrupt stored value", () => {
    localStorage.setItem("radar-sidebar:hidden-bots:v1", "{nope");
    resetHiddenBots();
    localStorage.setItem("radar-sidebar:hidden-bots:v1", "{nope");
    const { result } = renderHook(() => useVisibleBots(roster, []));
    expect(result.current.bots).toHaveLength(2);
  });
});

describe("asking bots stay visible", () => {
  it("keeps a hidden bot visible while its key is in the asking set", async () => {
    const { useVisibleBots, hideBot, resetHiddenBots } = await import("./botVisibility");
    const { renderHook } = await import("@testing-library/react");
    resetHiddenBots();
    const bot = { key: "home", name: "Home Bot", current: "thr_home" } as never;
    hideBot("home");
    const hiddenView = renderHook(() => useVisibleBots([bot], []));
    expect(hiddenView.result.current.bots).toHaveLength(0);
    const askingView = renderHook(() => useVisibleBots([bot], [], ["home"]));
    expect(askingView.result.current.bots).toHaveLength(1);
    expect(askingView.result.current.hiddenBots).toHaveLength(0);
    resetHiddenBots();
  });
});

describe("askingBotKeys", () => {
  const coordinators = [makeThread({ id: "p-root", latestAttentionAt: 10 }), makeThread({ id: "h-root", latestAttentionAt: 20 })];
  const item = (bot: string, state: NeedsItem["state"]): NeedsItem => makeNeed({ id: `need-${bot}-${state}`, bot, state });
  const judged = (threadId: string, version: number, extra: Partial<CrewJudgement>): CrewJudgement =>
    ({ threadId, version, waiting: 0.95, ask: "Should I book?", ...extra } as CrewJudgement);
  it("collects open saved items and judged or spelled-out coordinator asks", () => {
    const pulses = new Map<string, Pulse>([["p-root", { subject: "Deploy", decision: "Type your sudo password", quiet: false }]]);
    expect([...askingBotKeys(roster, coordinators, pulses, new Map(), [])]).toEqual(["personal"]);
    expect([...askingBotKeys(roster, coordinators, new Map(), new Map([["h-root", judged("h-root", 20, {})]]), [])]).toEqual(["home"]);
    expect([...askingBotKeys(roster, coordinators, new Map(), new Map(), [item("home", "open"), item("personal", "done"), item("personal", "dropped")])]).toEqual(["home"]);
    expect([...askingBotKeys(roster, coordinators, new Map(), new Map(), [item("home", "snoozed")])]).toEqual(["home"]);
  });
  it("drops a dismissed or stale judgement and protects the given keys while saved asks are unknown", () => {
    const dismissed = new Map([["h-root", judged("h-root", 20, { dismissed: true })]]);
    expect([...askingBotKeys(roster, coordinators, new Map(), dismissed, [])]).toEqual([]);
    const stale = new Map([["h-root", judged("h-root", 19, {})]]);
    expect([...askingBotKeys(roster, coordinators, new Map(), stale, [])]).toEqual([]);
    expect([...askingBotKeys(roster, coordinators, new Map(), new Map(), null, ["home"])]).toEqual(["home"]);
    expect([...askingBotKeys(roster, coordinators, new Map(), new Map(), [], ["home"])]).toEqual([]);
  });
});
