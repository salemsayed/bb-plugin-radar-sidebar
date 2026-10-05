import { describe, expect, it } from "vitest";
import { makeThread } from "./fixtures";
import { botState, botStyle, crewDigest, needsYou, parsePulse, shortBotName } from "./bots";

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
    expect(botState(undefined, null, null)).toBe("idle");
    expect(botState(makeThread({ ...base, indicator: "unread-error", isUnread: true }), null, null)).toBe("failed");
    expect(botState(makeThread({ ...base, hasPendingInteraction: true }), null, null)).toBe("needs-you");
    expect(botState(makeThread({ ...base, status: "active" }), null, null)).toBe("working");
    expect(botState(makeThread(base), null, "summary")).toBe("rollover");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: "pay?", quiet: false }, null)).toBe("decision");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: false }, null)).toBe("unread");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: true }, null)).toBe("idle");
    expect(botState(makeThread(base), { subject: "x", decision: "pay?", quiet: false }, null)).toBe("idle");
    // A running worker makes the bot "working"; an unseen decision still wins.
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: null, quiet: false }, null, { live: 1, needsUser: 0, failed: 0 })).toBe("working");
    expect(botState(makeThread({ ...base, isUnread: true }), { subject: "x", decision: "pay?", quiet: false }, null, { live: 1, needsUser: 0, failed: 0 })).toBe("decision");
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
    expect(botStyle("home", "Home Bot")).toEqual({ emoji: "🏠", hue: 146 });
    const a = botStyle("newbot", "New Bot"), b = botStyle("newbot", "New Bot");
    expect(a).toEqual(b);
    expect(a.emoji).toBe("N");
  });
  it("summarises the crew in one line", () => {
    expect(crewDigest(["idle", "idle"])).toBe("All quiet");
    expect(crewDigest(["decision", "needs-you", "working", "failed", "unread"])).toBe("1 failed · 2 waiting on you · 1 working · 1 new");
  });
});
