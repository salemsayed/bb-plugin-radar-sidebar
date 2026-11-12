import { desk, tasks } from "../build";
import { HOUR, MINUTE, ago, cairo } from "../clock";
import type { Scenario } from "./types";

export const text: Scenario[] = [
  {
    id: "long-english",
    title: "Long English titles",
    look: "Titles, questions, goals and worker names that run long, with unbroken strings. Nothing may overflow, and a cut must end on a word.",
    sketch: {
      focus: "lab",
      bots: {
        lab: {
          lastReply: ago(3 * MINUTE),
          desks: [
            desk("lab", "feedback", "Yasser from the Riyadh installer support team", "the export button on the monthly installer points statement page is missing when the phone is in landscape orientation", "blocked", { updated: 17 * MINUTE }),
            desk("lab", "chat", "Operations", "weekly_reconciliation_report_2026-11-09_to_2026-11-15_final_v3_corrected.xlsx needs a second look before Thursday", "working", { updated: 4 * MINUTE }),
          ],
          tasks: [
            tasks.needs({ bot: "lab", title: "Replace the nightly full database dump with incremental snapshots on all three servers", outcome: "Nightly backups on solom-dedi, salem-pc and the homeserver take under ten minutes each, are restorable to any hour of the last fourteen days, and a failed backup raises one alert instead of thirty", asked: { text: "backups take forever and i get thirty alerts every time one of them fails, can we do something smarter than a full dump every single night", at: ago(3 * HOUR) } },
              "Switch all three servers to incremental snapshots tonight, which needs each database stopped for roughly four minutes between 02:00 and 02:30, or keep the full dumps until the weekend when nobody is using the systems?", ago(11 * MINUTE),
              { options: ["Switch tonight between 02:00 and 02:30", "Wait until the weekend", "Only the homeserver tonight"], recommended: "Wait until the weekend", consequence: "Tonight's full dump is expected to run past 07:00 and slow the morning reports." }),
            tasks.working({ id: "l-long", bot: "lab", title: "Investigate why the account pool keeps routing Opus requests to an exhausted account after failover", outcome: "The account pool never sends a request to an account whose five-hour window is spent, proven by replaying yesterday's 412 failed requests against the fixed router", asked: { text: "pool keeps picking the dead account, https://example.com/internal/pool/logs?from=2026-11-11T22:00:00Z&to=2026-11-12T06:00:00Z&status=429&group=account", at: ago(70 * MINUTE) } },
              "Worker replays yesterday's failed requests against the router and compares each routing decision with the account's quota at that second", { runningFor: 64 * MINUTE, progress: { done: "All 412 failed requests are replayed and 380 of them reproduce the wrong routing decision.", now: "Tracing why the quota cache is read before the failover marks the account as exhausted." } }),
            tasks.waitingOnSomeone({ bot: "lab", title: "Upstream pull request for the sidebar scroll restoration fix", outcome: "The scroll restoration fix is merged upstream so the local patch can be dropped", asked: { text: "send it upstream", at: cairo(-4, "12:00") } },
              "The maintainer asked for a smaller reproduction and said he would look again after the next release is out.", "the maintainer's review", cairo(5, "10:00")),
            tasks.done({ bot: "lab", title: "Consolidate every agent instruction file across the eight bots, their projects and the three machines into one master" }, ago(2 * HOUR)),
          ],
        },
      },
      workers: { "l-long": [{ title: "Investigate why the account pool keeps routing Opus requests to an exhausted account after failover: replay", state: "running", started: 64 * MINUTE }] },
    },
  },
  {
    id: "arabic",
    title: "Arabic titles and asks",
    look: "Everything a bot wrote in Arabic: titles, a question with answers, a goal, desks. Text reads right to left, marks and times stay where the eye expects them.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(2 * MINUTE),
          desks: [
            desk("erbareeq", "chat", "محمد عمر", "استبدال ٨٠ لمبة BQ1323 بـ BQ1383", "blocked", { updated: 9 * MINUTE }),
            desk("erbareeq", "whatsapp", "الفقير الي الله", "رسالة جديدة عن الضمان", "info", { updated: 2 * HOUR }),
            desk("erbareeq", "chat", "أوامر الشغل", "حد أقصى ٢٠ وات لجامان", "waiting", { updated: 45 * MINUTE, waitingOn: "شريف", wakeAt: cairo(1, "09:00") }),
            desk("erbareeq", "chat", "المخزن", "تم تأكيد عدد الكراتين", "done", { updated: 3 * HOUR }),
          ],
          tasks: [
            tasks.needs({ bot: "erbareeq", title: "فاتورة ٥٤١٠٥", outcome: "تخرج الفاتورة ٥٤١٠٥ اليوم بالكرتونة الموجودة في المخزن والضمان باسم العميل الصحيح", asked: { text: "وده كود الكرتونه", at: ago(40 * MINUTE) } },
              "هل نرسل الفاتورة ٥٤١٠٥ بالكرتونة الموجودة الآن أم ننتظر إصلاح الماسح؟", ago(5 * MINUTE), { options: ["أرسلها الآن", "انتظر الإصلاح"], recommended: "أرسلها الآن", consequence: "السيارة تتحرك الساعة ٣ عصراً." }),
            tasks.working({ id: "a-photos", bot: "erbareeq", title: "صور الملف الشخصي في تطبيق سطح المكتب", outcome: "يعرض تطبيق المحادثة على سطح المكتب الصور الحقيقية كما في الويب", asked: { text: "التطبيق مش بيعرض الصور", at: ago(30 * MINUTE) } },
              "العامل يضيف الصور ثم يصدر النسخة ٠.٦.٢", { runningFor: 22 * MINUTE, progress: { done: "تم إعادة إنتاج مشكلة الصور المفقودة.", now: "كتابة الكود الذي يحمّل الصور ويعرضها." } }),
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "اسم المرسل في رسائل أورنج", outcome: "تصل تأكيدات الطلبات باسم بريق", asked: { text: "الرسائل لسه بتيجي من رقم", at: cairo(-2, "14:00") } }, "أورنج تراجع طلب اسم المرسل.", "أورنج", cairo(2, "12:00")),
            tasks.done({ bot: "erbareeq", title: "تحديث قائمة الأسعار" }, ago(3 * HOUR)),
            tasks.done({ bot: "erbareeq", title: "مطابقة مخزون أورنج" }, cairo(-1, "17:00")),
          ],
        },
      },
      workers: { "a-photos": [{ title: "صور الملف الشخصي", state: "running", started: 22 * MINUTE }] },
    },
  },
  {
    id: "mixed-languages",
    title: "Mixed Arabic and English in one line",
    look: "Product codes, arrows, numbers and English words inside Arabic sentences, and Arabic names inside English ones. Each line keeps its own direction without scrambling the codes.",
    sketch: {
      focus: "erbareeq",
      bots: {
        erbareeq: {
          lastReply: ago(4 * MINUTE),
          desks: [
            desk("erbareeq", "chat", "هندسة (U-01)", "R-000230 BQ138 carton + 80 BQ1323→BQ1383", "blocked", { updated: 8 * MINUTE }),
            desk("erbareeq", "chat", "Sherif", "طلب 8841 split على invoice-ين", "draft", { updated: 21 * MINUTE }),
            desk("erbareeq", "whatsapp", "Abanoub", "عرض سعر 80W floodlight ×12", "working", { updated: 3 * MINUTE }),
          ],
          tasks: [
            tasks.needs({ bot: "erbareeq", title: "Invoice 54105 (الراعى والملكه, شرم الشيخ)", outcome: "Invoice 54105 (الراعى والملكه, شرم الشيخ) leaves today with the right carton", asked: { text: "وده كود الكرتونه. https://warranty.bareeq.lighting/c/00d573bb", at: ago(38 * MINUTE) } },
              "Ship invoice 54105 to الراعى والملكه with carton BQ138-0042, or wait for the «تعذّر تحميل المحادثة» fix first?", ago(6 * MINUTE), { options: ["Ship BQ138-0042", "انتظر"], consequence: "Truck to شرم الشيخ leaves 15:00." }),
            tasks.working({ id: "m-web", bot: "erbareeq", title: "Web chat «تعذّر تحميل المحادثة»", outcome: "The cause of the web chat failing to load conversations («تعذّر تحميل المحادثة») is found and fixed", asked: { text: "Works now but keeps coming back, are you sure rune is not related?", at: ago(40 * MINUTE) } },
              "Worker reproduces «تعذّر تحميل المحادثة» in a background tab", { runningFor: 31 * MINUTE, progress: { done: "الخطأ يظهر مع 3 من 16 محادثة.", now: "Timing every request for those 3 chats." } }),
            tasks.waitingOnSomeone({ bot: "erbareeq", title: "موافقة Sherif على الـ piastres", outcome: "Sherif approves how leftover piastres are handled", asked: { text: "خلّي Sherif يوافق الأول", at: cairo(-1, "11:00") } }, "Waiting for Sherif (شريف) to approve the rounding.", "Sherif's approval", cairo(1, "10:00")),
            tasks.done({ bot: "erbareeq", title: "BQ1323→BQ1383 swap note" }, ago(HOUR)),
          ],
        },
      },
      workers: { "m-web": [{ title: "Web chat «تعذّر تحميل المحادثة»", state: "running", started: 31 * MINUTE }] },
    },
  },
];
