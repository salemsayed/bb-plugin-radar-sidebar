import { describe, expect, it } from "vitest";
import { makeThread } from "./fixtures";
import { askPulse, botState, botStyle, coordinatorAsk, crewDigest, needsYou, parsePulse, pulsePreview, shortBotName } from "./bots";

describe("parsePulse", () => {
  it("reads the subject, a decision line and the quiet marker", () => {
    expect(parsePulse("**Orange eth2** renews tomorrow.\nNo change to the plan.\nNothing to do."))
      .toEqual({ subject: "Orange eth2 renews tomorrow.", decision: null, quiet: true });
    expect(parsePulse("JUMAN transfer leg moved.\n- Keep watching.\nDecision needed: alert on update proposals too?"))
      .toEqual({ subject: "JUMAN transfer leg moved.", decision: "alert on update proposals too?", quiet: false });
    expect(parsePulse("Hi Salem, nothing is waiting on me.")).toEqual({ subject: "Hi Salem, nothing is waiting on me.", decision: null, quiet: false });
    expect(parsePulse("BOT_READY_muus5eu3_z5am1up\n\nNo unfinished user request remains.")).toEqual({ subject: "No unfinished user request remains.", decision: null, quiet: false });
    expect(parsePulse("HANDOFF_abc_123\nUnfinished: none.")).toEqual({ subject: "Unfinished: none.", decision: null, quiet: false });
    expect(parsePulse("BOT_READY_x_y")).toBeNull();
    expect(parsePulse("snake_case_name stays intact.")?.subject).toBe("snake_case_name stays intact.");
    expect(parsePulse("")).toBeNull();
    expect(parsePulse(null)).toBeNull();
  });
});

describe("botState", () => {
  const base = { id: "bot", title: "Personal Bot" };
  it("ranks attention, execution, rollover, then what the reply asked", () => {
    expect(botState(undefined, null, null)).toBe("unavailable");
    expect(botState(makeThread({ ...base, indicator: "unread-error", isUnread: true }), null, null)).toBe("failed");
    expect(botState(makeThread({ ...base, hasPendingInteraction: true }), null, null)).toBe("needs-you");
    expect(botState(makeThread({ ...base, status: "active" }), null, null)).toBe("working");
    expect(botState(makeThread(base), null, "summary")).toBe("rollover");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: "pay?", quiet: false }, null)).toBe("decision");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: false }, null)).toBe("unread");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: true }, null)).toBe("unread");
    expect(botState(makeThread(base), { subject: "x", decision: "pay?", quiet: false }, null)).toBe("decision");
    // A running worker makes the bot "working"; an unseen decision still wins.
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: false }, null, { live: 1, needsUser: 0, failed: 0 })).toBe("working");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: "pay?", quiet: false }, null, { live: 1, needsUser: 0, failed: 0 })).toBe("decision");
  });
  it("distinguishes queued, failed-queue, background work, handover and an answered decision", () => {
    expect(botState(makeThread({ ...base, queuedWork: "waiting" }), null, null)).toBe("queued");
    expect(botState(makeThread({ ...base, queuedWork: "failed" }), null, null)).toBe("failed");
    expect(botState(makeThread({ ...base, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 } }), null, null)).toBe("working");
    expect(botState(makeThread({ ...base, status: "active" }), null, "summary")).toBe("rollover");
    expect(botState(makeThread({ ...base, status: "active" }), { subject: "x", decision: "pay?", quiet: false }, null)).toBe("working");
    expect(botState(makeThread(base), { subject: "Paid", decision: null, quiet: true }, null)).toBe("idle");
  });
  it("needsYou covers questions, approvals and unseen failures", () => {
    expect(needsYou(makeThread({ id: "a", hasPendingInteraction: true }))).toBe(true);
    expect(needsYou(makeThread({ id: "b", indicator: "waiting-for-input" }))).toBe(true);
    expect(needsYou(makeThread({ id: "c", indicator: "unread-error" }))).toBe(true);
    expect(needsYou(makeThread({ id: "d", indicator: "unread-success", isUnread: true }))).toBe(false);
  });
  it("shortens bot names for cards", () => {
    expect(shortBotName("Personal Bot")).toBe("Personal");
    expect(shortBotName("ERBareeq Bot")).toBe("ERBareeq");
  });
});

describe("deck flavour", () => {
  it("gives known bots a face and colour and unknown ones a stable fallback", () => {
    expect(botStyle("home", "Home Bot")).toEqual({ emoji: "🏠", hue: 146, mascot: "home" });
    const a = botStyle("newbot", "New Bot"), b = botStyle("newbot", "New Bot");
    expect(a).toEqual(b);
    expect(a.emoji).toBe("N");
    expect(a.mascot).toBeNull();
  });
  it("summarises the crew in one line", () => {
    expect(crewDigest(["idle", "idle"])).toBe("All quiet");
    expect(crewDigest(["decision", "needs-you", "working", "failed", "unread"])).toBe("1 failed · 2 waiting on you · 1 working · 1 new");
  });
});


describe("hover reply preview", () => {
  it("keeps useful prose and removes protocol and duplicate decision lines", () => {
    expect(pulsePreview("BOT_READY_x\n**Checked the schedule.**\nNothing to do.\nDecision needed: approve?" )).toBe("Checked the schedule.");
    expect(pulsePreview("Decision needed: approve?" )).toBeNull();
  });
  it("marks a long excerpt instead of stopping mid-word", () => {
    const text = "A useful update with details. ".repeat(25);
    const preview = pulsePreview(text)!;
    expect(preview.length).toBeLessThanOrEqual(321);
    expect(preview).toMatch(/…$/);
    expect(text.startsWith(preview.slice(0, -1))).toBe(true);
  });
});

describe("the single ask record", () => {
  const thread = makeThread({ id: "coord", latestAttentionAt: 200 });
  const pulse = { subject: "Tickets are EGP 800 each.", decision: null, quiet: false };
  const judged = { threadId: "coord", version: 200, waiting: 0.9, ask: "Should I book two?", itemId: "n1" };
  it("reads the judged reply, falls back to the decision line, and honours Done", () => {
    expect(coordinatorAsk(thread, pulse, judged)).toEqual({ text: "Should I book two?", itemId: "n1" });
    expect(coordinatorAsk(thread, pulse, null)).toBeNull();
    expect(coordinatorAsk(thread, { ...pulse, decision: "book two? Prices rise Monday." }, null)).toEqual({ text: "book two? Prices rise Monday.", itemId: null });
    // The judgement of this reply is the record: an older reply's verdict, a low score, or Jev down defer to the line.
    expect(coordinatorAsk(thread, pulse, { ...judged, version: 100 })).toBeNull();
    expect(coordinatorAsk(thread, pulse, { ...judged, waiting: 0.2 })).toBeNull();
    expect(coordinatorAsk(thread, { ...pulse, decision: "go?" }, { ...judged, waiting: null, ask: null, itemId: null })).toEqual({ text: "go?", itemId: null });
    expect(coordinatorAsk(thread, { ...pulse, decision: "go?" }, { ...judged, dismissed: true })).toBeNull();
    expect(coordinatorAsk({ ...thread, status: "active" }, { ...pulse, decision: "go?" }, judged)).toEqual({ text: judged.ask, itemId: "n1" });
    expect(coordinatorAsk(thread, null, { ...judged, ask: null, itemId: null })).toEqual({ text: "Waiting for your answer", itemId: null });
  });
  it("gives the rail a pulse whose decision is that record", () => {
    expect(askPulse(thread, pulse, judged)).toEqual({ ...pulse, decision: "Should I book two?" });
    expect(askPulse(thread, null, judged)).toEqual({ subject: "Should I book two?", quiet: false, decision: "Should I book two?" });
    expect(askPulse(thread, { ...pulse, decision: "go?" }, { ...judged, dismissed: true })).toEqual({ ...pulse, decision: null });
    expect(askPulse(thread, null, null)).toBeNull();
    const running = { ...thread, status: "active" as const };
    expect(askPulse(running, { ...pulse, decision: "go?" }, judged)).toEqual({ ...pulse, decision: "go?" });
    expect(botState(thread, askPulse(thread, pulse, { ...judged, dismissed: true }), null)).toBe("idle");
    expect(botState(thread, askPulse(thread, pulse, judged), null)).toBe("decision");
  });
});
