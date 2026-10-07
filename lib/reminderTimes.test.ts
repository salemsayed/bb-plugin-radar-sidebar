import { describe, expect, it } from "vitest";
import { cairoInstant, cairoLocal, dueLabel, reminderChoices } from "./reminderTimes";
import { crewDigest } from "../components/radar/bots";
import { makeNeed, NEEDS_NOW } from "../components/radar/needsFixtures";
import { openNeeds, reminderText } from "./needs";

describe("Cairo reminder times", () => {
  it("uses Cairo, independent of the test machine's London timezone", () => {
    expect(cairoLocal(NEEDS_NOW)).toBe("2026-10-07T13:00");
    expect(reminderChoices(NEEDS_NOW).map(choice => choice.until)).toEqual([
      "2026-10-07T15:00:00.000Z", "2026-10-08T06:00:00.000Z", "2026-10-12T06:00:00.000Z",
    ]);
    expect(cairoInstant("2026-11-02T09:00")).toBe("2026-11-02T07:00:00.000Z");
  });
  it("disables elapsed today, rolls Monday forward, and rejects nonexistent times", () => {
    expect(reminderChoices(Date.parse("2026-10-12T16:00Z"))[0]?.disabled).toBe(true);
    expect(reminderChoices(Date.parse("2026-10-12T16:00Z"))[2]?.until).toBe("2026-10-19T06:00:00.000Z");
    expect(() => cairoInstant("2026-04-24T00:30")).toThrow(/unavailable/);
    expect(() => cairoInstant("2026-02-31T09:00")).toThrow();
  });
  it("renders due labels in Cairo even near midnight and for offsetless dates", () => {
    expect(dueLabel("2026-10-07", NEEDS_NOW)).toBe("today");
    expect(dueLabel("2026-10-08T09:00", NEEDS_NOW)).toBe("1 day");
    expect(dueLabel("2026-10-11", NEEDS_NOW)).toBe("4 days");
    expect(dueLabel("2026-10-15", NEEDS_NOW)).toBe("15 Oct");
    expect(dueLabel("2026-10-07T22:00Z", Date.parse("2026-10-07T21:05Z"))).toBe("today");
  });
});
it("orders active needs by their real instant, null last, and counts persistent asks", () => {
  const items = [makeNeed({ id: "none", due: null }), makeNeed({ id: "later", due: "2026-10-08T09:00Z" }), makeNeed({ id: "first", due: "2026-10-08T10:00+03:00" }), makeNeed({ id: "closed", state: "done" }), makeNeed({ id: "hidden", state: "snoozed" })];
  expect(openNeeds(items).map(item => item.id)).toEqual(["hidden", "first", "later", "none"]);
  expect(crewDigest(["idle", "working"], items)).toBe("4 waiting on you · 1 working");
  expect(crewDigest(["decision"], items)).toBe("4 waiting on you");
  expect(crewDigest(["decision"], null)).toBe("1 waiting on you");
});
it("takes the first meaningful message line", () => {
  expect(reminderText("BOT_READY_ab12\n\n# **Pay school installment**\nAnother line")).toBe("Pay school installment");
  expect(reminderText("a".repeat(200))).toHaveLength(120);
  expect(reminderText("Automation notice (not a request or authorization):\nYour next reply is the alert Salem reads.\n\nFinding:\n⏰ Mum apt: send the current balance.\n\nAbout auto_8ryf9xcl1v4 · BOT_AUTOMATION_NOTICE_x"))
    .toBe("⏰ Mum apt: send the current balance.");
});
