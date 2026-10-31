const TECHNICAL_ID = /\s*\b(?:thr|env|proj|host|notif)_[a-z0-9]{6,}\b/gi;

export function plainNote(text: string): string {
  return text
    .replace(TECHNICAL_ID, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function taskHeadline(title: string): string {
  const full = title.trim().replace(/\s+/g, " ");
  const bare = full.replace(/\s*\([^()]{12,}\)/g, "").replace(/\s{2,}/g, " ").trim();
  const base = bare.length >= 20 ? bare : full;
  const head = /^(.{20,110}?)(?::\s|;\s|\s[—–]\s)/.exec(base)?.[1];
  return (head ?? base).trim();
}

const SHORT_PART = 28;

export function splitStatus(status: string): { state: string; meta: string; note: string } {
  const [state = "", ...rest] = status.split(" · ");
  const meta: string[] = [], note: string[] = [];
  for (const part of rest) (part.length <= SHORT_PART && !note.length ? meta : note).push(part);
  return { state, meta: meta.join(" · "), note: note.join(" · ") };
}

export type StateTone = "needs" | "blocked" | "busy" | "quiet" | "done" | "ended";

export function stateTone(state: string): StateTone {
  if (state === "needs") return "needs";
  if (state === "overdue" || state === "offline" || state === "retrying") return "blocked";
  if (state === "working" || state === "queued" || state === "checking") return "busy";
  if (state === "done") return "done";
  if (state === "cancelled" || state === "stopped") return "ended";
  return "quiet";
}
