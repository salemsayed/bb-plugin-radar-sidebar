import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { answerSubmissionKind } from "./answerSubmission";

const submission = z.object({ kind: z.literal(answerSubmissionKind), question: z.string().min(1).max(1024) });
const proceed = { action: "proceed" } as const;

export function registerAnswerAdmission(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS radar_question_sends(question TEXT PRIMARY KEY) WITHOUT ROWID");
  const insert = db.prepare("INSERT INTO radar_question_sends(question) VALUES(?) ON CONFLICT(question) DO NOTHING");
  bb.experimental_hooks.on("message.dispatch", ctx => {
    const tagged = ctx.experimental_submission;
    if (tagged?.pluginId !== bb.pluginId || typeof tagged.data !== "object" || tagged.data === null || !("kind" in tagged.data) || tagged.data.kind !== answerSubmissionKind) return proceed;
    const parsed = submission.safeParse(tagged.data);
    if (!parsed.success || ctx.initiator !== "user" || ctx.senderThreadId) return { action: "reject", message: "Open the question again before answering." };
    if (insert.run(parsed.data.question).changes) return proceed;
    return { action: "reject", message: "An answer was already attempted. Check the chat and queue. If the answer is missing, reply in chat." };
  });
}
