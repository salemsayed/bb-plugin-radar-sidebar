import { tasks } from "../build";
import { DAY, HOUR, MINUTE, ago, cairo } from "../clock";
import type { Scenario } from "./types";

export const quiet: Scenario[] = [
  {
    id: "new-bot",
    title: "Brand new bot",
    look: "No tasks, no desks, no history: the panel says so in one line and stays short.",
    sketch: { focus: "security", bots: { security: { tasks: [], lastReply: ago(2 * DAY) } } },
  },
  {
    id: "nothing-to-do",
    title: "Nothing to do",
    look: "Nothing open. Finished work is the only content and must not look like work in progress.",
    sketch: {
      focus: "home",
      bots: {
        home: {
          lastReply: ago(3 * HOUR),
          tasks: [
            tasks.done({ bot: "home", title: "Garage camera offline", outcome: "The garage camera is back online and records to the NVR again" }, ago(3 * HOUR)),
            tasks.done({ bot: "home", title: "Guest Wi-Fi password", outcome: "The guest Wi-Fi has a new password and the QR card on the fridge matches it" }, cairo(-1, "19:20")),
            tasks.done({ bot: "home", title: "Thermostat schedule", outcome: "The living-room thermostat follows the winter schedule" }, cairo(-3, "09:05")),
          ],
        },
      },
    },
  },
  {
    id: "chatting-only",
    title: "Replying in chat, nothing filed",
    look: "The bot is answering in its chat with no task filed: the header says it is busy, the body stays calm.",
    sketch: { focus: "personal", bots: { personal: { chatting: true, lastReply: ago(MINUTE), tasks: [tasks.done({ bot: "personal", title: "Dentist booking" }, cairo(-2, "11:00"))] } } },
  },
  {
    id: "just-finished",
    title: "Just finished",
    look: "A task closed two minutes ago and nothing else is open: the fresh result is easy to find, older results stay folded.",
    sketch: {
      focus: "store",
      bots: {
        store: {
          lastReply: ago(2 * MINUTE),
          tasks: [
            tasks.done({ bot: "store", title: "Review email branding", outcome: "Review request and confirmation emails carry the store logo instead of the generic lightbulb, and review requests are confirmed still sending", asked: { text: "the review emails still show a lightbulb", at: ago(50 * MINUTE) } }, ago(2 * MINUTE)),
            tasks.done({ bot: "store", title: "Store look fixes", outcome: "Cards show specs and a bigger price, the deals show before the cart, and phones reach the first product sooner" }, ago(2 * HOUR)),
            tasks.done({ bot: "store", title: "Store redesign directions", outcome: "A design audit and 3 redesign directions, each on an unpublished theme copy with phone and desktop screenshots" }, ago(4 * HOUR)),
            tasks.unconfirmed({ bot: "store", title: "Cart drawer upsell" }, ago(5 * HOUR)),
            tasks.done({ bot: "store", title: "Shipping rates table" }, cairo(-1, "16:10")),
            tasks.done({ bot: "store", title: "Abandoned cart emails" }, cairo(-2, "12:30")),
          ],
        },
      },
    },
  },
];
