export const CAIRO = "Africa/Cairo";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function cairoLocal(now: number): string {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert a native datetime-local wall clock using Cairo's actual DST rules. */
export function cairoInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Choose a date and time.");
  const wall = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("Choose a valid date and time.");
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const seen = Date.parse(`${cairoLocal(instant)}:00Z`);
    instant += wall - seen;
  }
  // Reject clocks skipped by DST rather than silently changing Salem's time.
  if (cairoLocal(instant) !== local) throw new Error("That time is unavailable in Cairo. Choose another time.");
  return new Date(instant).toISOString();
}

export function reminderChoices(now: number): { label: string; until: string; disabled: boolean }[] {
  const today = cairoLocal(now).slice(0, 10);
  const date = new Date(`${today}T12:00:00Z`);
  const day = (offset: number) => new Date(date.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const mondayOffset = (8 - date.getUTCDay()) % 7;
  const mondayToday = cairoInstant(`${today}T09:00`);
  const nextMonday = mondayOffset === 0 && Date.parse(mondayToday) <= now ? 7 : mondayOffset;
  return [
    { label: "Later today · 18:00", until: cairoInstant(`${today}T18:00`) },
    { label: "Tomorrow · 09:00", until: cairoInstant(`${day(1)}T09:00`) },
    { label: "Monday · 09:00", until: cairoInstant(`${day(nextMonday)}T09:00`) },
  ].map(choice => ({ ...choice, disabled: Date.parse(choice.until) <= now }));
}

export function dueLabel(due: string | null, now: number): string | null {
  if (!due) return null;
  const date = /(Z|[+-]\d{2}:\d{2})$/.test(due) ? cairoLocal(Date.parse(due)).slice(0, 10) : due.slice(0, 10);
  const days = Math.round((Date.parse(`${date}T12:00Z`) - Date.parse(`${cairoLocal(now).slice(0, 10)}T12:00Z`)) / 86400000);
  if (days === 0) return "today";
  if (days > 0 && days <= 7) return `${days} ${days === 1 ? "day" : "days"}`;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T12:00Z`));
}

export function snoozedLabel(until: string): string {
  const instant = /(Z|[+-]\d{2}:\d{2})$/.test(until) ? Date.parse(until) : Date.parse(cairoInstant(until.slice(0, 16)));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  return `Snoozed until ${time} Cairo`;
}
