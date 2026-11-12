export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const CAIRO_OFFSET_HOURS = 2;

export const NOW = Date.UTC(2026, 10, 12, 13 - CAIRO_OFFSET_HOURS, 40);

export function ago(ms: number): number {
  return NOW - ms;
}

export function ahead(ms: number): number {
  return NOW + ms;
}

export function cairo(dayOffset: number, clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number) as [number, number];
  return Date.UTC(2026, 10, 12 + dayOffset, hours - CAIRO_OFFSET_HOURS, minutes);
}

const stampDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short" });
const stampClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function shortDay(at: number): string {
  return stampDay.format(new Date(at));
}

export function clock(at: number): string {
  return stampClock.format(new Date(at));
}

export function stamp(at: number): string {
  return `${shortDay(at)} ${clock(at)}`;
}

export function span(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function freezeClock(): void {
  Date.now = () => NOW;
}
