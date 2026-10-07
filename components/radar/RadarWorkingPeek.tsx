import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Phase, WorkingDigest, workingRpcContract } from "@/lib/workingDigest";

const REFRESH_MS = 6_000;
/** No row, thought or background update for this long reads as stalled. */
const QUIET_MS = 5 * 60_000;
const SHOWN = 6;

const PHASE_LABELS: Record<Phase, string> = {
  thinking: "Thinking",
  exploring: "Exploring",
  editing: "Editing",
  testing: "Testing",
  building: "Building",
  shipping: "Shipping",
  researching: "Researching",
  delegating: "Delegating",
  running: "Running commands",
};

// Last answers survive the card closing, so a second peek paints at once.
const remembered = new Map<string, WorkingDigest>();

/** Server-side digests for the working threads, refreshed while the peek is open. */
export function useWorkingDigests(threadIds: readonly string[]): ReadonlyMap<string, WorkingDigest> {
  const rpc = useRpc<typeof workingRpcContract>();
  const [digests, setDigests] = useState<ReadonlyMap<string, WorkingDigest>>(
    () => new Map(threadIds.flatMap((id) => (remembered.has(id) ? [[id, remembered.get(id)!]] : []))),
  );
  const key = threadIds.join("|");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () => {
      rpc.call("working_digest", { threadIds: key.split("|").slice(0, 12) }).then((result) => {
        if (cancelled) return;
        for (const digest of result.digests) remembered.set(digest.threadId, digest);
        setDigests(new Map(result.digests.map((digest) => [digest.threadId, digest])));
      }).catch(() => {
        // An older Radar server or a transient failure: the card shows sidebar facts only.
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rpc, key]);
  return digests;
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

type Flag = { key: "needs-you" | "failing" | "quiet" | "context" | "fallback" | "background"; text: string; tone: string };

/** The signals worth a glance, most urgent first. */
export function workingFlags(thread: PluginSidebarThread, digest: WorkingDigest | undefined, now: number): Flag[] {
  const flags: Flag[] = [];
  if (thread.hasPendingInteraction) flags.push({ key: "needs-you", text: "Waiting on you", tone: "radar-tone-warning" });
  if (!digest) return flags;
  if (digest.failingStreak >= 2) flags.push({ key: "failing", text: `${digest.failingStreak} failed commands in a row`, tone: "radar-tone-error" });
  const quietFor = digest.lastActivityAt === null ? 0 : now - digest.lastActivityAt;
  if (quietFor >= QUIET_MS && digest.background === 0 && !thread.hasPendingInteraction) {
    flags.push({ key: "quiet", text: `Quiet for ${duration(quietFor)}`, tone: "radar-tone-warning" });
  }
  if (digest.context !== null && digest.context >= 0.8) flags.push({ key: "context", text: `Context ${Math.round(digest.context * 100)}% full`, tone: "radar-tone-warning" });
  if (digest.fallback) flags.push({ key: "fallback", text: `Fell back to ${digest.fallback}`, tone: "radar-tone-info" });
  if (digest.background > 0) flags.push({ key: "background", text: `${digest.background} in the background`, tone: "radar-tone-info" });
  return flags;
}

const URGENCY: Record<Flag["key"], number> = { "needs-you": 0, failing: 1, quiet: 2, context: 3, fallback: 4, background: 5 };

/**
 * Hover the Working drawer's header to see what every running thread is
 * doing without opening it: its latest words and step, todo progress, how
 * long it has run, and anything that needs a look (stalls, failing commands,
 * a full context, a waiting question).
 */
export function RadarWorkingPeek({
  threads,
  anchor,
  now,
  projectName,
  parentTitle,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: {
  threads: readonly PluginSidebarThread[];
  anchor: { top: number; bottom: number; left: number; right: number };
  now: number;
  projectName: (thread: PluginSidebarThread) => string | null;
  /** The thread a nested reply belongs to, so workers read in context. */
  parentTitle: (thread: PluginSidebarThread) => string | null;
  onOpen: (threadId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const digests = useWorkingDigests(threads.map((thread) => thread.id));
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const items = threads.map((thread) => {
    const digest = digests.get(thread.id);
    return { thread, digest, flags: workingFlags(thread, digest, now) };
  }).sort((a, b) =>
    (a.flags.length ? URGENCY[a.flags[0]!.key] : 9) - (b.flags.length ? URGENCY[b.flags[0]!.key] : 9)
    || (a.digest?.runningSince ?? now) - (b.digest?.runningSince ?? now));
  const longest = items.reduce((max, item) => Math.max(max, item.digest?.runningSince ? now - item.digest.runningSince : 0), 0);
  const tally = (key: Flag["key"]) => items.filter((item) => item.flags.some((flag) => flag.key === key)).length;
  const summary = ([["needs-you", "waiting on you"], ["failing", "failing"], ["quiet", "quiet"], ["context", "near a full context"]] as const)
    .filter(([key]) => tally(key) > 0).map(([key, words]) => `${tally(key)} ${words}`);

  // Beside the sidebar, bottom-aligned with the header (the drawer sits at
  // the foot of the list), clamped inside the viewport before paint.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const gap = 10;
    const left = anchor.right + gap + width <= window.innerWidth - 8 ? anchor.right + gap : Math.max(8, anchor.left - gap - width);
    const top = Math.max(8, Math.min(anchor.bottom - height, window.innerHeight - height - 8));
    setPosition((previous) => (previous?.top === top && previous.left === left ? previous : { top, left }));
  }, [anchor.top, anchor.bottom, anchor.left, anchor.right, digests, threads.length]);

  return (
    <div
      ref={card}
      role="dialog"
      aria-label="Working threads"
      className="radar-hover-card radar-working-peek"
      style={position ?? { visibility: "hidden" }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="radar-peek-head">
        <strong>Working</strong>
        <span className="radar-peek-count">{threads.length}</span>
        {longest > 0 ? <span className="radar-peek-head-meta">longest {duration(longest)}</span> : null}
      </div>
      {summary.length > 0 ? <p className="radar-peek-summary radar-tone-warning">{summary.join(" · ")}</p> : null}
      <ul className="radar-peek-list">
        {items.slice(0, SHOWN).map(({ thread, digest, flags }) => {
          const project = projectName(thread);
          const parent = parentTitle(thread);
          const meta = [
            parent ? `in ${parent}` : project,
            digest?.phase ? PHASE_LABELS[digest.phase] : null,
            digest && digest.steps > 0 ? `${digest.steps} step${digest.steps === 1 ? "" : "s"}` : null,
            digest?.context != null && digest.context < 0.8 ? `${Math.round(digest.context * 100)}% context` : null,
          ].filter(Boolean);
          return (
            <li key={thread.id}>
              <button type="button" className="radar-peek-item" onClick={() => onOpen(thread.id)}>
                <span className="radar-peek-title">
                  <span className={cn("radar-dot", flags[0]?.key === "failing" ? "radar-dot-error" : flags[0]?.key === "needs-you" ? "radar-dot-attention" : "radar-dot-running")} aria-hidden="true" />
                  <span className="radar-peek-title-text">{thread.displayTitle || thread.title || "Untitled thread"}</span>
                  {digest?.runningSince ? <span className="radar-peek-time" title="Running for">{duration(now - digest.runningSince)}</span> : null}
                </span>
                {meta.length > 0 ? <span className="radar-peek-meta">{meta.join(" · ")}</span> : null}
                {digest?.goal ? <span className="radar-peek-line"><b>Goal</b> {digest.goal}</span> : null}
                {digest?.saying ? <span className="radar-peek-saying">“{digest.saying}”</span> : null}
                {digest?.doing ? (
                  <span className="radar-peek-doing">
                    <span className={cn("radar-peek-doing-icon", digest.doing.pending && "radar-spinner")} aria-hidden="true">
                      <Icon name={digest.doing.pending ? "Loading" : "Check"} />
                    </span>
                    <span>{digest.doing.label}</span>
                    {digest.doing.detail ? <code>{digest.doing.detail}</code> : null}
                  </span>
                ) : null}
                {digest?.todos ? (
                  <span className="radar-peek-todos">
                    <span className="radar-peek-progress" aria-hidden="true">
                      <span style={{ width: `${(digest.todos.done / digest.todos.total) * 100}%` }} />
                    </span>
                    <span>{digest.todos.done}/{digest.todos.total}{digest.todos.current ? ` · ${digest.todos.current}` : ""}</span>
                  </span>
                ) : null}
                {flags.length > 0 ? (
                  <span className="radar-peek-flags">
                    {flags.map((flag) => <span key={flag.key} className={cn("radar-peek-flag", flag.tone)}>{flag.text}</span>)}
                  </span>
                ) : null}
                {!digest ? <span className="radar-peek-muted">Reading the latest steps…</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN ? <p className="radar-peek-muted">{items.length - SHOWN} more in the drawer</p> : null}
    </div>
  );
}
