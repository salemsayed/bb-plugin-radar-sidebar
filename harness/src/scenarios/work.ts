import { tasks, type Worker } from "../build";
import { DAY, HOUR, MINUTE, ago, ahead, cairo } from "../clock";
import type { Scenario } from "./types";

const fleet: Worker[] = [
  ...["Theme audit: product page", "Theme audit: cart", "Theme audit: checkout", "Theme audit: collection", "Theme audit: search", "Theme audit: account", "Theme audit: footer", "Theme audit: emails"].map((title, i): Worker => ({ title, state: "running", started: (6 + i * 3) * MINUTE })),
  ...["Theme audit: plan", "Theme audit: inventory", "Theme audit: first pass", "Theme audit: retry 1", "Theme audit: retry 2", "Theme audit: screenshots"].map((title, i): Worker => ({ title, state: i === 3 ? "error" : "idle", started: (90 + i * 20) * MINUTE, ended: (40 + i * 15) * MINUTE })),
];

export const work: Scenario[] = [
  {
    id: "working",
    title: "Tasks being worked on",
    look: "Four tasks with live workers: what each worker is doing now, how long it has run, and one whose worker went quiet.",
    sketch: {
      focus: "store",
      bots: {
        store: {
          lastReply: ago(6 * MINUTE),
          tasks: [
            tasks.working({ id: "t-reviews", bot: "store", title: "Real customer reviews", outcome: "The home page reviews section shows real, checkable customer reviews instead of typed testimonials, live on the store", asked: { text: "reviews still looks fake tbh, we need to have some sort of authenticity", at: ago(14 * MINUTE) } },
              "Design worker sources real reviews (Judge.me, Google) and rebuilds the section on a theme copy, then publishes", { runningFor: 5 * MINUTE, progress: { done: "The store's real customer reviews are found, 31 on products still for sale.", now: "Checking Google for a public business profile with reviews." } }),
            tasks.working({ id: "t-sweep", bot: "store", title: "Old setup sweep", outcome: "Every customer-facing and admin leftover from the old store setup is found in one pass", asked: { text: "you keep working and you keep findings gaps from the old setup :/", at: ago(25 * MINUTE) } },
              "Worker inventories every store touchpoint against today's settings, fixes reversible leftovers, reports once", { runningFor: 16 * MINUTE, progress: { done: "The store theme and products are clean of old-setup leftovers.", now: "Checking the review app's emails for old branding." } }),
            tasks.working({ id: "t-feed", bot: "store", title: "Meta catalog feed", outcome: "The Meta catalog shows every in-stock product with the right price", asked: { text: "half the products are missing from the fb shop", at: ago(3 * HOUR) } },
              "Worker rebuilds the feed and waits for Meta to re-read it", { runningFor: 2 * HOUR + 40 * MINUTE, alert: "quiet" }),
            tasks.working({ id: "t-two", bot: "store", title: "Black Friday landing page", outcome: "The Black Friday page is live with the three cart deals", asked: { text: "bf page needs to be up by friday", at: ago(70 * MINUTE) } },
              "Two workers: one builds the page, one writes the Arabic copy", { runningFor: 55 * MINUTE }),
            tasks.retrying({ bot: "store", title: "Klaviyo export", outcome: "The subscriber list is exported before the plan ends", asked: { text: "export the list before we cancel", at: ago(40 * MINUTE) } }),
            tasks.done({ bot: "store", title: "Review email branding" }, ago(50 * MINUTE)),
          ],
        },
      },
      workers: {
        "t-reviews": [{ title: "Real customer reviews: design", state: "running", started: 5 * MINUTE }],
        "t-sweep": [{ title: "Old setup sweep", state: "running", started: 16 * MINUTE }],
        "t-feed": [{ title: "Meta catalog feed", state: "running", started: 160 * MINUTE }, { title: "Meta catalog feed: first try", state: "error", started: 175 * MINUTE, ended: 165 * MINUTE }],
        "t-two": [{ title: "Black Friday landing page: build", state: "running", started: 55 * MINUTE }, { title: "Black Friday landing page: Arabic copy", state: "running", started: 30 * MINUTE }],
      },
    },
  },
  {
    id: "many-workers",
    title: "Many workers on one task",
    look: "One task with 8 workers running and 6 finished, next to ordinary tasks. The crowd must not bury the rest.",
    sketch: {
      focus: "store",
      bots: {
        store: {
          lastReply: ago(4 * MINUTE),
          unlinked: [{ title: "Competitor price scrape", started: 18 * MINUTE }],
          tasks: [
            tasks.working({ id: "t-audit", bot: "store", title: "Theme audit", outcome: "Every page of the store theme is audited on phone and desktop with one list of fixes", asked: { text: "audit the whole theme, every page", at: ago(3 * HOUR) } },
              "Eight workers audit one page each; the bot merges their lists", { runningFor: 30 * MINUTE, progress: { done: "Six pages are audited, 41 issues so far.", now: "Auditing the account pages and the emails." } }),
            tasks.working({ id: "t-copy", bot: "store", title: "Product copy rewrite", outcome: "The 40 best sellers have new Arabic descriptions", asked: { text: "descriptions are too long", at: ago(80 * MINUTE) } },
              "Worker rewrites the best sellers' descriptions", { runningFor: 44 * MINUTE }),
            tasks.waitingOnBot({ bot: "store", title: "Cart deals review", outcome: "Before the three cart deals end on 11 Dec, their results and a recommendation" }, "Waiting for 7 December to review the cart deals before they end on 11 December.", cairo(25, "10:00")),
            tasks.done({ bot: "store", title: "Store look fixes" }, ago(3 * HOUR)),
          ],
        },
      },
      workers: { "t-audit": fleet, "t-copy": [{ title: "Product copy rewrite", state: "running", started: 44 * MINUTE }] },
    },
  },
  {
    id: "waiting-outside",
    title: "Waiting on someone or something else",
    look: "Nothing here is Salem's move: a named person, a date, a scheduled run, and one wait with no date at all. When each one moves again must be obvious.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(90 * MINUTE),
          tasks: [
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "Bot handles every payment case", outcome: "A proven way for the bot to handle every Black Friday prepaid case without finance", asked: { text: "Can the bot handle split orders without finance?", at: cairo(-3, "11:10") } },
              "Waiting for Sherif to approve how the leftover piastres are handled before Yasser signs off; Salem is asking him.", "Sherif's approval", cairo(1, "10:00")),
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "Orange bulk SMS sender name", outcome: "Order confirmations go out under the Bareeq sender name", asked: { text: "sms still comes from a number", at: cairo(-5, "14:00") } },
              "Orange is reviewing the sender-name request; they answer within 5 working days.", "Orange", cairo(2, "12:00")),
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "Warehouse label printer", outcome: "The second label printer prints carton codes", asked: { text: "second printer prints blank", at: cairo(-1, "16:30") } },
              "The supplier's technician visits the warehouse to replace the print head.", undefined),
            tasks.waitingOnBot({ bot: "erbareeq", title: "When the Black Friday watch ends", outcome: "When the Black Friday watch ends (Mon 30 Nov 21:30), its schedule is removed and the final campaign results are reported" },
              "Black Friday watch runs until Mon 30 Nov 21:30 Cairo", cairo(18, "21:45"), 2 * DAY),
            tasks.waitingOnBot({ bot: "erbareeq", title: "Klaviyo cancel check", outcome: "Klaviyo's paid plan ends on 15 Nov as scheduled and no new charge lands on the card" },
              "Waiting for Klaviyo's renewal time on 15 November to confirm the plan ended and nothing was charged.", cairo(3, "13:45")),
            tasks.waitingOnRun({ bot: "erbareeq", title: "Nightly stock report", outcome: "Tonight's stock report counts returns once" }, "The fix is checked against tonight's 23:30 run"),
            tasks.waitingOnBot({ bot: "erbareeq", title: "Price list rounding", outcome: "Prices in the dealer list round the same way as the invoices" }, "Waiting for the next price update to compare both lists"),
            tasks.done({ bot: "erbareeq", title: "Minimum app version 1.0.8" }, ago(5 * HOUR)),
          ],
        },
      },
    },
  },
  {
    id: "stuck",
    title: "Stuck, failed and overdue",
    look: "A check that was due hours ago, a machine that is off, a failed check nobody acted on, a start that keeps being retried, and a worker stuck in a loop. Trouble must stand apart from ordinary waiting.",
    sketch: {
      focus: "bricks",
      bots: {
        bricks: {
          lastReply: ago(5 * HOUR),
          tasks: [
            tasks.overdue({ bot: "bricks", title: "Installer points reconciliation", outcome: "October installer points match the redemption ledger", asked: { text: "points dont match the ledger", at: cairo(-2, "12:00") } }, cairo(0, "09:00")),
            tasks.machineOff({ bot: "bricks", title: "iOS build 1.0.9", outcome: "Build 1.0.9 is uploaded to TestFlight", asked: { text: "ship 1.0.9 to testflight", at: ago(4 * HOUR) } }, 2 * HOUR),
            tasks.checkFailed({ bot: "bricks", title: "Warranty date reset", outcome: "Ticket 4412's warranty starts from the install date", asked: { text: "يرجي تحديث الضمان", at: cairo(-1, "15:00") } }, 2, 3, cairo(-1, "18:00")),
            tasks.queued({ bot: "bricks", title: "Seminar gifts import", outcome: "The 212 seminar attendees get their gift points", asked: { text: "import the seminar sheet", at: ago(35 * MINUTE) } }, "no worker slot free on the pool", ahead(12 * MINUTE)),
            tasks.working({ id: "t-loop", bot: "bricks", title: "QR scan duplicates", outcome: "A QR scanned twice counts once", asked: { text: "installers are getting double points", at: ago(3 * HOUR) } },
              "Worker reproduces the double scan on the staging app", { runningFor: 2 * HOUR + 10 * MINUTE, alert: "stuck", progress: { done: "The double count is reproduced on staging.", now: "Trying the same database fix again." } }),
            tasks.retrying({ bot: "bricks", title: "GitLab mirror sync", outcome: "The GitHub mirror is one commit behind at most", asked: { text: "mirror is days behind", at: ago(50 * MINUTE) } }),
            tasks.notChecked({ bot: "bricks", title: "Installer app crash on Android 12", outcome: "The installer app opens on Android 12", asked: { text: "app closes on old samsung", at: ago(6 * HOUR) } }),
            tasks.done({ bot: "bricks", title: "Ticket 4398 points credit" }, cairo(-1, "11:00")),
          ],
        },
      },
      workers: { "t-loop": [{ title: "QR scan duplicates", state: "running", started: 130 * MINUTE }] },
    },
  },
  {
    id: "deferred",
    title: "Queued for capacity and not started",
    look: "Work that has not begun: queued for a free worker with a next try, filed but not started, and one the bot holds itself. None of it is running and none of it is stuck.",
    sketch: {
      focus: "personal",
      bots: {
        personal: {
          lastReply: ago(15 * MINUTE),
          tasks: [
            tasks.queued({ bot: "personal", title: "Car insurance quotes", outcome: "Three renewal quotes compared on price and cover", asked: { text: "insurance renewal is next month", at: ago(20 * MINUTE) } }, "the account pool is at its limit until 14:05", ahead(25 * MINUTE)),
            tasks.queued({ bot: "personal", title: "Flight options to Riyadh", outcome: "Three flight options for 20 Nov with prices", asked: { text: "find me flights for the 20th", at: ago(12 * MINUTE) } }, "waiting for a free worker", ahead(4 * MINUTE)),
            tasks.notStarted({ bot: "personal", title: "Passport renewal checklist", outcome: "A checklist of documents and the nearest office with its hours", asked: { text: "passport expires in march", at: cairo(-1, "21:15") } }),
            tasks.withTheBot({ bot: "personal", title: "School fees reminder", outcome: "A reminder lands a week before the second instalment", asked: { text: "remind me about the fees", at: ago(3 * HOUR) } }, "Sets the reminder once the school confirms the date"),
            tasks.checking({ bot: "personal", title: "Gym membership freeze", outcome: "The gym membership is frozen for December", asked: { text: "freeze the gym for december", at: ago(5 * HOUR) } }, 1, 3),
            tasks.done({ bot: "personal", title: "Dentist booking" }, cairo(-1, "11:00")),
          ],
        },
      },
    },
  },
  {
    id: "closed-history",
    title: "A week of closed tasks",
    look: "Two things open, forty closed over the week: done, closed by Salem, cancelled, stopped, closed after a quiet day, done but not confirmed. The history must fold away and still be reachable.",
    sketch: {
      focus: "lab",
      bots: {
        lab: {
          lastReply: ago(30 * MINUTE),
          tasks: [
            tasks.working({ id: "t-status", bot: "lab", title: "Desk status fix", outcome: "Desk rows show their real state", asked: { text: "the \"working\" status is wrong for some i guess", at: ago(26 * MINUTE) } },
              "Worker fixes core and Radar, proves it live, deploys", { runningFor: 15 * MINUTE, progress: { done: "The fix is live, and the waiting marks are back on three desks.", now: "Taking screenshots of the desk list on desktop and phone." } }),
            tasks.waitingOnBot({ bot: "lab", title: "Worktree cleanup", outcome: "One weekly worktree cleanup covers every bot on all three servers" }, "Second clean run is the scheduled Sun 15 Nov 09:30 run", cairo(3, "10:00"), 4 * DAY),
            tasks.done({ bot: "lab", title: "Worker progress summary", outcome: "Worker progress summaries moved to a neutral folder" }, ago(40 * MINUTE)),
            tasks.done({ bot: "lab", title: "Radar form answers" }, ago(3 * HOUR)),
            tasks.unconfirmed({ bot: "lab", title: "Oppo Pad unlock command" }, ago(4 * HOUR)),
            tasks.closedByYou({ bot: "lab", title: "Tesla CarPlay adapter firmware" }, ago(5 * HOUR)),
            tasks.done({ bot: "lab", title: "One home per rule" }, cairo(-1, "20:30")),
            tasks.done({ bot: "lab", title: "AGENTS.md consolidation audit" }, cairo(-1, "17:05")),
            tasks.cancelled({ bot: "lab", title: "Bakery landing page test" }, cairo(-1, "15:20")),
            tasks.stopped({ bot: "lab", title: "Scroll memory replay" }, cairo(-1, "12:00"), 2),
            tasks.quietClose({ bot: "lab", title: "Homeserver reboot check" }, cairo(-2, "10:00")),
            ...Array.from({ length: 31 }, (_, i) => tasks.done({ bot: "lab", title: ["Auto Effort judge retry", "Brrr dedupe window", "Radar swipe actions", "Browse tab cleanup", "Account pool failover", "Handbook nightly sync", "Bots page zoom lock", "Keep Going idle rule", "Feedback desk routing", "html-plan mockups"][i % 10]! + (i >= 10 ? ` ${Math.floor(i / 10) + 1}` : "") }, cairo(-2 - Math.floor(i / 6), `${String(9 + (i % 6) * 2).padStart(2, "0")}:15`))),
          ],
        },
      },
      workers: { "t-status": [{ title: "Desk status fix", state: "running", started: 15 * MINUTE }] },
    },
  },
];
