import { need, tasks } from "../build";
import { HOUR, MINUTE, ago, cairo } from "../clock";
import type { Scenario } from "./types";

export const crew: Scenario[] = [
  {
    id: "busy-crew",
    title: "A busy day across all ten bots",
    look: "Five bots working, two asking, one waiting, one just finished and one idle. Every face must read at a glance and only the working ones may move.",
    sketch: {
      focus: "erbareeq",
      bots: {
        chief: { chatting: true, lastReply: ago(MINUTE), tasks: [tasks.done({ bot: "chief", title: "Morning brief" }, cairo(0, "10:15"))] },
        personal: {
          lastReply: ago(9 * MINUTE),
          tasks: [tasks.needs({ bot: "personal", title: "Dentist booking", outcome: "The dentist visit is booked", asked: { text: "book the dentist", at: ago(40 * MINUTE) } },
            "Thursday 17:00 or Saturday 11:00 for the dentist?", ago(9 * MINUTE), { options: ["Thursday 17:00", "Saturday 11:00"] })],
        },
        home: {
          lastReply: ago(4 * MINUTE),
          tasks: [tasks.working({ id: "h-cam", bot: "home", title: "Garage camera offline", outcome: "The garage camera records again", asked: { text: "garage cam is down", at: ago(22 * MINUTE) } }, "Worker restarts the camera and checks the recorder", { runningFor: 12 * MINUTE })],
        },
        bricks: {
          lastReply: ago(3 * MINUTE),
          tasks: [tasks.working({ id: "b-warranty", bot: "bricks", title: "Warranty date resets", outcome: "Today's warranty tickets are closed", asked: { text: "grab my bricks tickets", at: ago(35 * MINUTE) } }, "Worker resets six warranty dates", { runningFor: 18 * MINUTE })],
        },
        work: {
          lastReply: ago(2 * HOUR),
          tasks: [tasks.waitingOnSomeone({ bot: "work", title: "Container release papers", outcome: "The Damietta container is released" }, "The shipping line is preparing the release.", "the shipping line", cairo(1, "09:00"))],
        },
        erbareeq: {
          lastReply: ago(MINUTE),
          tasks: [
            tasks.working({ id: "e-scan", bot: "erbareeq", title: "Scanner fix for postponed invoices", outcome: "The scanner handles a postponed invoice", asked: { text: "scanner refuses the carton", at: ago(38 * MINUTE) } }, "Worker builds the scanner fix", { runningFor: 24 * MINUTE }),
            tasks.working({ id: "e-prices", bot: "erbareeq", title: "December price update", outcome: "December prices are loaded and checked", asked: { text: "new prices from the 1st", at: ago(3 * HOUR) } }, "Worker loads the sheet into staging", { runningFor: 50 * MINUTE }),
          ],
        },
        store: {
          lastReply: ago(6 * MINUTE),
          tasks: [tasks.done({ bot: "store", title: "Review email branding" }, ago(50 * MINUTE))],
        },
        lab: {
          lastReply: ago(2 * MINUTE),
          tasks: [tasks.working({ id: "l-faces", bot: "lab", title: "Bot faces redesign", outcome: "The bots have a new look that costs less to draw", asked: { text: "new design for the bots", at: ago(30 * MINUTE) } }, "Worker measures the sidebar before and after", { runningFor: 28 * MINUTE })],
        },
        redflag: { lastReply: ago(14 * MINUTE), tasks: [tasks.done({ bot: "redflag", title: "Weekly refund scan" }, ago(14 * MINUTE))] },
        security: { lastReply: ago(5 * HOUR), tasks: [tasks.done({ bot: "security", title: "Firewall review" }, cairo(-1, "18:00"))] },
      },
      needs: [need("store", "Decision needed: the Black Friday banner is ready. Publish it tonight or on Friday morning?", ago(6 * MINUTE), { options: ["Tonight", "Friday morning"] })],
      workers: {
        "h-cam": [{ title: "Garage camera", state: "running", started: 12 * MINUTE }],
        "b-warranty": [{ title: "Warranty date resets", state: "running", started: 18 * MINUTE }],
        "e-scan": [{ title: "Scanner fix", state: "running", started: 24 * MINUTE }],
        "e-prices": [{ title: "December price update", state: "running", started: 50 * MINUTE }],
        "l-faces": [{ title: "Bot faces redesign", state: "running", started: 28 * MINUTE }],
      },
    },
  },
];
