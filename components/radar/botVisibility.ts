import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { coordinatorAsk, type Pulse, type RosterBot } from "./bots";
import { botFamily } from "./botScope";
import type { CrewJudgement } from "@/lib/crewAsk";
import type { NeedsItem } from "@/lib/needs";

/**
 * Bots the user hid from the rail, deck and crew, remembered per client like
 * the rail scope. The roster itself stays untouched: hidden bots keep their
 * workers tucked away and keep answering the Needs list, they just lose
 * their tile.
 *
 * Rule: a hidden bot still surfaces while something needs the user, that is
 * while any thread in its family (coordinator plus visible descendants) is
 * waiting for input or has failed and the failure is still unread. An ask is
 * never hidden. Once the family is quiet again, or the failure has been read,
 * the bot goes back out of sight without any further action.
 */

const HIDDEN_KEY = "radar-sidebar:hidden-bots:v1";

function readHidden(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

let hidden: ReadonlySet<string> = readHidden();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();

function writeHidden(next: ReadonlySet<string>): void {
  hidden = next;
  try {
    if (next.size === 0) localStorage.removeItem(HIDDEN_KEY);
    else localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  } catch {
    // Preference simply won't persist.
  }
  for (const listener of listeners) listener();
}

export function hideBot(key: string): void {
  if (hidden.has(key)) return;
  writeHidden(new Set([...hidden, key]));
}

export function unhideBot(key: string): void {
  if (!hidden.has(key)) return;
  const next = new Set(hidden);
  next.delete(key);
  writeHidden(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Keys the user hid, live across every subscriber. */
export function useHiddenBotKeys(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hidden, () => EMPTY);
}

/**
 * Family threads that must surface a hidden bot: unread failures and open
 * asks. bb never clears `status: "error"` or `queuedWork: "failed"` when a
 * thread is read, so a failure only counts while it is unread (or still
 * waiting for input); otherwise a bot with one old
 * failed worker could never be hidden.
 */
export function botDemandsAttention(threads: readonly PluginSidebarThread[], bot: RosterBot): boolean {
  return botFamily(threads, bot).some(t =>
    t.hasPendingInteraction || t.indicator === "waiting-for-input" ||
    (t.isUnread && (t.status === "error" || t.queuedWork === "failed" ||
      t.indicator === "unread-error" || t.indicator === "queued-failed")));
}

/**
 * Bot keys with an open plain-language ask, for `useVisibleBots`: a saved
 * Needs item that is still open, or the coordinator's single ask record
 * (`coordinatorAsk`). While the saved-ask data is unavailable (`items` null)
 * the keys in `whileUnknown` are protected too, so unknown data never hides
 * something that might need Salem. The rail, the Crew view and the deck all
 * build their set this way.
 */
export function askingBotKeys(
  roster: readonly RosterBot[],
  coordinators: readonly PluginSidebarThread[],
  pulses: ReadonlyMap<string, Pulse>,
  judgements: ReadonlyMap<string, CrewJudgement>,
  items: readonly NeedsItem[] | null,
  whileUnknown: Iterable<string> = [],
): Set<string> {
  const keys = new Set((items ?? []).filter(item => item.state !== "done" && item.state !== "dropped").map(item => item.bot));
  for (const bot of roster) {
    const thread = coordinators.find(thread => thread.id === bot.current);
    if (thread && coordinatorAsk(thread, pulses.get(thread.id) ?? null, judgements.get(thread.id))) keys.add(bot.key);
  }
  if (items === null) for (const key of whileUnknown) keys.add(key);
  return keys;
}

export interface VisibleBots {
  /** Roster minus hidden bots, in roster order; attention overrides hiding. */
  bots: RosterBot[];
  /** Hidden bots currently out of sight (not surfaced by attention). */
  hiddenBots: RosterBot[];
  isHidden: (key: string) => boolean;
  /** Whether attention or an ask would override hiding this bot right now, so Hide would change nothing visible. */
  isProtected: (key: string) => boolean;
  hide: (key: string) => void;
  unhide: (key: string) => void;
}

/**
 * The roster as the user wants to see it. Pass the sidebar threads so a
 * hidden bot with a failed thread or a pending question still shows, and
 * `asking` for bot keys with an open plain-language ask (a judged
 * "Decision needed" line or a saved Needs item), which bb's thread flags do
 * not carry. Those bots surface too: an ask is never hidden.
 */
export function useVisibleBots(roster: readonly RosterBot[], threads: readonly PluginSidebarThread[],
  asking?: Iterable<string>): VisibleBots {
  const keys = useHiddenBotKeys();
  const askingKey = asking ? [...asking].sort().join("\u0000") : "";
  const split = useMemo(() => {
    const asked = new Set(askingKey ? askingKey.split("\u0000") : []);
    const protectedKeys = new Set<string>();
    const bots: RosterBot[] = [];
    const hiddenBots: RosterBot[] = [];
    for (const bot of roster) {
      if (asked.has(bot.key) || botDemandsAttention(threads, bot)) protectedKeys.add(bot.key);
      if (keys.has(bot.key) && !protectedKeys.has(bot.key)) hiddenBots.push(bot);
      else bots.push(bot);
    }
    return { bots, hiddenBots, protectedKeys };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, threads, keys, askingKey]);
  const isHidden = useCallback((key: string) => keys.has(key), [keys]);
  const isProtected = useCallback((key: string) => split.protectedKeys.has(key), [split.protectedKeys]);
  return { bots: split.bots, hiddenBots: split.hiddenBots, isHidden, isProtected, hide: hideBot, unhide: unhideBot };
}

/** Test hook: forget every hidden bot and subscriber. */
export function resetHiddenBots(): void {
  hidden = new Set();
  listeners.clear();
  try {
    localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Ignore.
  }
}
