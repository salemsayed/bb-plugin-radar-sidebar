import { desk, need, tasks } from "../build";
import { DAY, HOUR, MINUTE, ago, cairo } from "../clock";
import type { Scenario } from "./types";

export const asks: Scenario[] = [
  {
    id: "one-urgent-question",
    title: "One urgent question",
    look: "One question with answers, a recommendation and what happens if it waits. It must be the first thing read.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(2 * MINUTE),
          tasks: [
            tasks.needs({ bot: "erbareeq", title: "Invoice 54105 scan", outcome: "Invoice 54105 can leave today with the carton the warehouse has now, with its warranty under the right customer", asked: { text: "وده كود الكرتونه", at: ago(38 * MINUTE) } },
              "Send invoice 54105 with the carton the warehouse scanned, or hold it until the scanner fix is live?", ago(2 * MINUTE),
              { options: ["Send it now", "Hold until the fix"], recommended: "Send it now", consequence: "The truck leaves at 15:00; after that the invoice ships tomorrow." }),
            tasks.working({ bot: "erbareeq", title: "Desktop profile photos", outcome: "The desktop chat app shows real profile photos wherever the web chat does", asked: { text: "rune desktop app is not showing profile photos", at: ago(26 * MINUTE) } },
              "Worker adds photos and sturdier image loading, then releases 0.6.2", { runningFor: 24 * MINUTE, progress: { done: "The old version's missing photos are reproduced.", now: "Writing the code that loads and shows profile photos." } }),
            tasks.done({ bot: "erbareeq", title: "U-01 missed message" }, ago(70 * MINUTE)),
          ],
        },
      },
      workers: {},
    },
  },
  {
    id: "desk-question",
    title: "A desk waits on your answer (Salem's screenshot)",
    look: "The case in Salem's screenshot: one blocked chat desk plus working tasks. The desk's subject must be said once.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(MINUTE),
          desks: [
            desk("erbareeq", "chat", "هندسة (U-01)", "R-000230 BQ138 carton + 80 BQ1323→BQ1383", "blocked", { updated: 8 * MINUTE }),
            desk("erbareeq", "chat", "أوامر الشغل", "Gaman 20W limit (on hold)", "waiting", { updated: 40 * MINUTE }),
            desk("erbareeq", "chat", "Sherif", "health tab crash fixed, told him", "done", { updated: 3 * HOUR }),
          ],
          tasks: [
            tasks.working({ id: "t-scan", bot: "erbareeq", title: "Invoice 54105 scan", outcome: "Invoice 54105 (الراعى والملكه, شرم الشيخ) can leave today with the carton the warehouse has now, with its warranty under the right customer", asked: { text: "وده كود الكرتونه. warranty.bareeq.lighting", at: cairo(0, "13:02") } },
              "The warehouse scans the new carton for invoice 54105 in today's dispatch; the scanner fix is being built meanwhile.", { runningFor: 24 * MINUTE, progress: { done: "The fix is saved on the live server and its early checks passed.", now: "Waiting for the last checks, then testing the invoice." } }),
            tasks.working({ id: "t-photos", bot: "erbareeq", title: "Desktop profile photos", outcome: "The desktop chat app shows real profile photos wherever the web chat does, falling back to initials", asked: { text: "rune desktop app is not showing profile photos", at: cairo(0, "13:14") } },
              "Worker adds photos and sturdier image loading, then releases 0.6.2", { runningFor: 13 * MINUTE, progress: { done: "The old version's missing photos are reproduced, with thumbnails failing to load.", now: "Writing the code that loads and shows profile photos." } }),
            tasks.working({ id: "t-web", bot: "erbareeq", title: "Web chat loading", outcome: "The cause of the web chat failing to load conversations («تعذّر تحميل المحادثة») is found and fixed", asked: { text: "Works now but keeps coming back, are you sure rune is not related?", at: cairo(0, "13:02") } },
              "Worker reproduces it in a background tab and times every request", { runningFor: 29 * MINUTE, progress: { done: "All 16 chat opens loaded fast with the desktop app on and off.", now: "Restarting the desktop app to compare the results." } }),
            tasks.working({ id: "t-spec", bot: "erbareeq", title: "Sherif spec: technician program dashboard", outcome: "The technician program dashboard and one-page CEO report has a verified plan", asked: { text: "i have two recent emails, grab them and see if need to spawn two workers for them or not", at: cairo(0, "13:30") } },
              "Worker checks the scan rules and merchant link, then writes the plan", { runningFor: 6 * MINUTE }),
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "Bot handles every payment case", outcome: "A proven way for the bot to handle every prepaid case without finance", asked: { text: "Can the bot handle split orders without finance?", at: cairo(-3, "11:10") } },
              "Waiting for Sherif to approve how the leftover piastres are handled before Yasser signs off; Salem is asking him.", "Sherif's approval", cairo(1, "10:00")),
            tasks.waitingOnBot({ bot: "erbareeq", title: "When the Black Friday watch", outcome: "When the Black Friday watch ends (Mon 30 Nov 21:30), its schedule is removed and the final campaign results are reported", asked: { text: "🗂 Handoff tidy", at: cairo(-2, "09:56") } },
              "Black Friday watch runs until Mon 30 Nov 21:30 Cairo", cairo(18, "21:45"), 2 * DAY),
            tasks.notNow({ bot: "erbareeq", title: "Desktop chat update", outcome: "The chat app updates itself from the update notice", asked: { text: "on my salem-pc omarchy desktop", at: cairo(0, "12:37") } },
              "acceptance: the desktop chat update fix is live on Salem's PC.", cairo(0, "13:12"), cairo(1, "10:00")),
            tasks.done({ bot: "erbareeq", title: "U-01 missed message", outcome: "The U-01 desk has one draft covering both messages, and the chat watcher catches edited messages" }, ago(12 * MINUTE)),
            tasks.done({ bot: "erbareeq", title: "Demo password swap" }, ago(44 * MINUTE)),
            tasks.done({ bot: "erbareeq", title: "Minimum app version 1.0.8" }, ago(52 * MINUTE)),
            tasks.done({ bot: "erbareeq", title: "Orange stock sync" }, cairo(-1, "17:40")),
            tasks.done({ bot: "erbareeq", title: "Price list export" }, cairo(-2, "10:15")),
          ],
        },
      },
      workers: {
        "t-scan": [{ title: "Invoice 54105 scan: scanner fix", state: "running", started: 24 * MINUTE }],
        "t-photos": [{ title: "Desktop profile photos", state: "running", started: 13 * MINUTE }],
        "t-web": [{ title: "Web chat loading: timing", state: "running", started: 29 * MINUTE }],
      },
    },
  },
  {
    id: "several-questions",
    title: "Several questions, old and new",
    look: "A fresh yes/no, a Form ask from a worker, a typed step, a decision with a deadline, and two asks that are days old. Fresh ones lead; old ones must not shout as loudly.",
    sketch: {
      focus: "work",
      bots: {
        work: {
          lastReply: ago(3 * HOUR),
          tasks: [
            tasks.needs({ bot: "work", title: "Office VPN certificate", outcome: "The office VPN certificate is renewed before it expires on 14 Nov", asked: { text: "vpn cert expires this week", at: ago(50 * MINUTE) } },
              "Renew the VPN certificate now? Everyone connected is dropped for about a minute.", ago(4 * MINUTE), { options: ["Renew now", "Tonight at 23:00"], recommended: "Tonight at 23:00", consequence: "It expires Saturday 09:00; after that nobody can connect." }),
            tasks.needs({ id: "t-form", bot: "work", title: "Payroll export format", outcome: "The November payroll export matches what the bank's portal accepts", asked: { text: "bank rejected the file again", at: ago(2 * HOUR) } },
              "Which layout does the bank want for the November file?", ago(22 * MINUTE), { interactionId: "int_payroll_layout", options: ["CSV, one row per employee", "Fixed-width v2", "The portal's Excel template", "Ask the bank first"] }),
            tasks.needs({ bot: "work", title: "Router admin sign-in", outcome: "The EdgeRouter firmware is updated", asked: { text: "update the edgerouter", at: ago(5 * HOUR) } },
              "Type the 6-digit code from the authenticator app so I can sign in to the router.", ago(95 * MINUTE)),
            tasks.needs({ bot: "work", title: "Session tunnel provider", outcome: "The session tunnel runs on a provider that survives the WE outages", asked: { text: "tunnel dropped 3 times today", at: cairo(-2, "10:20") } },
              "Move the session tunnel to the second provider? It costs $6 a month more and takes ten minutes of downtime.", cairo(-2, "15:45"), { options: ["Yes, move it", "No, keep WE"] }),
            tasks.needs({ bot: "work", title: "CPS report wording", outcome: "The quarterly CPS report is sent", asked: { text: "draft the Q3 report", at: cairo(-6, "09:00") } },
              "The Q3 report draft is ready; it waits for your go before it is sent to the board.", cairo(-5, "14:10")),
            tasks.waitingOnBot({ bot: "work", title: "WE link health watch", outcome: "A week of link health data to decide on the second line" }, "Collecting a week of link health numbers", cairo(4, "09:00")),
            tasks.done({ bot: "work", title: "Printer driver rollout" }, cairo(-1, "13:00")),
          ],
        },
      },
      needs: [
        need("work", "Decision needed: the office NAS is 91% full. Delete the 2024 camera archive (frees 1.4 TB) or buy two more disks?", ago(9 * HOUR), { options: ["Delete the 2024 archive", "Buy two disks"], asked: "Delete the 2024 camera archive or buy two more disks for the office NAS?", consequence: "At this rate the NAS is full in about 9 days.", askSeq: 4410 }),
      ],
      workers: { "t-form": [{ title: "Payroll export format", state: "idle", started: 2 * HOUR, ended: 22 * MINUTE }] },
    },
  },
  {
    id: "later-items",
    title: "Later and answered",
    look: "Things Salem parked with Not now, a parked desk, and one he already answered that waits on the bot. None of them is urgent; all must be easy to bring back.",
    sketch: {
      focus: "lab",
      bots: {
        lab: {
          lastReply: ago(25 * MINUTE),
          desks: [desk("lab", "feedback", "Yasser", "export button missing on phone", "draft", { updated: 3 * HOUR, later: ago(2 * HOUR) })],
          tasks: [
            tasks.notNow({ bot: "lab", title: "Desktop chat update", outcome: "The chat app updates itself from the update notice (one button, restarts into the new version)", asked: { text: "on my salem-pc omarchy desktop", at: cairo(0, "12:37") } },
              "acceptance: the desktop chat update fix is live on Salem's PC.", cairo(0, "13:12"), cairo(1, "10:00")),
            tasks.notNow({ bot: "lab", title: "Homeserver disk swap", outcome: "The failing disk in the homeserver is replaced without data loss", asked: { text: "disk 3 has smart errors", at: cairo(-4, "18:00") } },
              "Order the replacement disk now or wait for the Black Friday price?", cairo(-3, "09:30")),
            tasks.answered({ bot: "lab", title: "Exact web app trial", outcome: "The new Exact web app can be opened on Salem's address at /x/ and switched back with /x/off", asked: { text: "Set it up", at: cairo(-1, "10:00") } },
              "The new app is live but only its sign-in page could be checked; Salem signs in once to see his Doods in it.", cairo(0, "08:52"), cairo(1, "10:00")),
            tasks.working({ id: "t-panel", bot: "lab", title: "Bot panel redesign", outcome: "The Radar bot panel shows clearly what needs Salem now", asked: { text: "i want a fable on this context menu", at: ago(12 * MINUTE) } },
              "Fable worker builds the scenario harness, redesigns, ships", { runningFor: 11 * MINUTE }),
            tasks.done({ bot: "lab", title: "One home per rule" }, cairo(-1, "20:30")),
            tasks.done({ bot: "lab", title: "AGENTS.md consolidation audit" }, cairo(-1, "17:05")),
          ],
        },
      },
      workers: { "t-panel": [{ title: "Bot panel redesign", state: "running", started: 11 * MINUTE }] },
      notNow: [],
    },
  },
];
