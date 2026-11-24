import assert from "node:assert/strict";
import { test } from "node:test";
import { deskAsk, deskParts } from "../components/radar/panel/status";
import type { BotDesk } from "../lib/botTasks";

test("deskParts separates ticket-numbered desks into channel badge and subject without treating ticket numbers as people", () => {
  assert.deepEqual(
    deskParts({ label: "Feedback", title: "Feedback #38 · collapsible customers section in app chats" }),
    { channel: "Feedback #38", person: "", subject: "Collapsible customers section in app chats" },
  );
  assert.deepEqual(
    deskParts({ label: "Feedback", title: "Feedback #37: renew warranty dates from stock-count QRs" }),
    { channel: "Feedback #37", person: "", subject: "Renew warranty dates from stock-count QRs" },
  );
  assert.deepEqual(
    deskParts({ label: "Bricks", title: "Bricks #5875 · Installer points" }),
    { channel: "Bricks #5875", person: "", subject: "Installer points" },
  );
  assert.deepEqual(
    deskParts({ label: "WhatsApp", title: "WhatsApp · Ahmed Taha · return 271 fixed" }),
    { channel: "WhatsApp", person: "Ahmed Taha", subject: "Return 271 fixed" },
  );
});

test("deskAsk writes natural prompts for ticket desks instead of addressing ticket numbers as people", () => {
  const draftDesk = {
    id: "d1",
    desk: "feedback",
    label: "Feedback",
    title: "Feedback #38 · collapsible customers section in app chats",
    status: "draft",
  } as BotDesk;
  assert.deepEqual(deskAsk(draftDesk), {
    question: "Approve the bot's draft?",
    about: "Collapsible customers section in app chats",
  });

  const blockedDesk = {
    id: "d2",
    desk: "feedback",
    label: "Feedback",
    title: "Feedback #37: renew warranty dates from stock-count QRs",
    status: "blocked",
  } as BotDesk;
  assert.deepEqual(deskAsk(blockedDesk), {
    question: "Renew warranty dates from stock-count QRs",
    about: "The bot needs your answer",
  });
});
