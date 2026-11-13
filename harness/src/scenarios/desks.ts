import { desk, tasks } from "../build";
import { DAY, HOUR, MINUTE, ago, cairo } from "../clock";
import type { Scenario } from "./types";

export const desks: Scenario[] = [
  {
    id: "desks-every-status",
    title: "Desks in every status",
    look: "Go-ahead needed, answer needed, working, waiting on a named person with a wake, waiting with nothing set, for your info, waiting for capacity with a deadline, done today, done days ago. One glance should sort them.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(9 * MINUTE),
          desks: [
            desk("erbareeq", "chat", "محمد عمر", "reply about the 3 rejected lamps", "draft", { updated: 6 * MINUTE, draft: "تم يا محمد، عملت استثناء لمرتجع 224 (٥٩ قطعة)\nومرتجع 270 (٤ قطع) ✅" }),
            desk("erbareeq", "whatsapp", "Team Light", "600-piece spot order", "draft", { updated: 9 * MINUTE }),
            desk("erbareeq", "chat", "هندسة (U-01)", "R-000230 BQ138 carton + 80 BQ1323→BQ1383", "blocked", { updated: 14 * MINUTE }),
            desk("erbareeq", "whatsapp", "Abanoub", "80W floodlight quote", "working", { updated: 2 * MINUTE }),
            desk("erbareeq", "bricks", "", "#4412 warranty date reset", "working", { updated: 11 * MINUTE }),
            desk("erbareeq", "chat", "أوامر الشغل", "Gaman 20W limit (on hold)", "waiting", { updated: 40 * MINUTE, waitingOn: "Sherif", wakeAt: cairo(1, "09:00") }),
            desk("erbareeq", "chat", "Finance", "split order 8841", "waiting", { updated: 3 * HOUR }),
            desk("erbareeq", "whatsapp", "الفقير الي الله", "new message", "info", { updated: 2 * HOUR }),
            desk("erbareeq", "chat", "محمد احمد", "Thanks for bonus fix", "info", { updated: 5 * HOUR }),
            desk("erbareeq", "campaign", "", "Black Friday broadcast", "deferred", { updated: 25 * MINUTE, deadline: cairo(1, "18:00"), deferredReason: "The account pool is at its limit" }),
            desk("erbareeq", "chat", "Sherif", "health tab crash fixed, told him", "done", { updated: 3 * HOUR }),
            desk("erbareeq", "redemption", "", "R-000228 gift card", "done", { updated: 6 * HOUR }),
            desk("erbareeq", "chat", "محمد سرحان", "Abanoub 80W floodlight follow-up", "done", { updated: 3 * DAY }),
            desk("erbareeq", "feedback", "Yasser", "export button missing", "done", { updated: 5 * DAY }),
          ],
          tasks: [
            tasks.working({ id: "t-web", bot: "erbareeq", title: "Web chat loading", outcome: "The cause of the web chat failing to load conversations is found and fixed", asked: { text: "keeps coming back", at: ago(35 * MINUTE) } }, "Worker times every request", { runningFor: 29 * MINUTE }),
            tasks.done({ bot: "erbareeq", title: "U-01 missed message" }, ago(70 * MINUTE)),
          ],
        },
      },
      workers: { "t-web": [{ title: "Web chat loading", state: "running", started: 29 * MINUTE }] },
    },
  },
  {
    id: "desks-only-done",
    title: "Only finished desks",
    look: "Forty desks closed over the week and nothing open: the Desks section must not become a wall of done rows.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(2 * HOUR),
          desks: Array.from({ length: 40 }, (_, i) => desk("erbareeq", i % 4 === 0 ? "whatsapp" : "chat", ["Sherif", "محمد عمر", "Abanoub", "Finance", "أوامر الشغل"][i % 5]!, ["order 88" + i + " shipped", "تم الرد على الاستفسار", "quote sent", "invoice corrected", "stock confirmed"][i % 5]!, "done", { updated: (i < 4 ? 2 + i * 3 : 20 + i * 4) * HOUR })),
          tasks: [tasks.done({ bot: "erbareeq", title: "Orange stock sync" }, ago(4 * HOUR))],
        },
      },
    },
  },
];
