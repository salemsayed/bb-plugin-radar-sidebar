import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { readStored, writeStored } from "./useListSettings";
import { threadActionTarget } from "./threadActions";
import { effectiveIndicator, isRunningThread, shortAgo } from "./time";
import { useThreadClaims } from "./useThreadClaims";
import { useRoving } from "./useRoving";

export const THREADS_OPEN_KEY = "radar-sidebar:threads-open:v1";
export const OPEN_THREADS_EVENT = "radar:open-threads";

function useThreadsOpen() {
  const [open, setOpen] = useState(() => readStored(THREADS_OPEN_KEY, "closed", ["closed", "open"]) === "open");
  useEffect(() => { writeStored(THREADS_OPEN_KEY, open ? "open" : "closed"); }, [open]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_THREADS_EVENT, show);
    return () => window.removeEventListener(OPEN_THREADS_EVENT, show);
  }, []);
  return [open, setOpen] as const;
}

type Mark = "needs" | "failed" | "running" | "unread" | "none";

function markOf(thread: PluginSidebarThread): Mark {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs";
  const indicator = effectiveIndicator(thread);
  if (thread.status === "error" || indicator === "unread-error" || indicator === "queued-failed") return "failed";
  if (isRunningThread(thread)) return "running";
  return thread.isUnread ? "unread" : "none";
}

const MARK_WORDS: Record<Mark, string> = { needs: "needs you", failed: "failed", running: "working", unread: "new reply", none: "" };
const MARK_TITLES: Record<Mark, string> = { needs: "Needs you", failed: "Failed", running: "Working now", unread: "New reply", none: "" };

function withDepth(threads: readonly PluginSidebarThread[]) {
  const ids = new Set(threads.map(thread => thread.id));
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const depth = (thread: PluginSidebarThread, seen = new Set<string>()): number => {
    const owner = [thread.parentThreadId, thread.lifecycleOwnerThreadId].find(id => id && ids.has(id) && !seen.has(id));
    if (!owner) return 0;
    seen.add(thread.id);
    return 1 + depth(byId.get(owner)!, seen);
  };
  return threads.map(thread => ({ thread, depth: Math.min(depth(thread), 3) }));
}

export function threadsSummary(threads: readonly PluginSidebarThread[]) {
  const loud = threads.map(markOf).filter(mark => mark === "needs" || mark === "failed" || mark === "unread");
  const needs = loud.filter(mark => mark === "needs").length;
  return { needs, loud: loud.length, failed: loud.includes("failed"), text: needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : loud.length ? `${loud.length} new` : "" };
}

export function ThreadsSection({ activeThreadId, now, onOpen, onShowAll }: { activeThreadId: string | null; now: number; onOpen: (id: string) => void; onShowAll?: () => void }) {
  const claims = useThreadClaims();
  const [open, setOpen] = useThreadsOpen();
  const listId = useId();
  const rows = useMemo(() => withDepth(claims.loose), [claims.loose]);
  const count = claims.ready ? claims.loose.length : null;
  const { needs, failed, text: summary } = threadsSummary(claims.ready ? claims.loose : []);
  const list = useRef<HTMLDivElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const roving = useRoving(list, { item: ".radar-thread-row", row: ".radar-thread-item", side: ".radar-thread-more", preferred: activeThreadId });
  return (
    <section className="radar-threads" aria-label="Other threads" data-open={open || undefined} data-thread-count={count ?? undefined}>
      <button type="button" className="radar-threads-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
        <Icon name="ChevronRight" aria-hidden="true" className="radar-threads-chevron" />
        <span className="radar-threads-label"><span>Other threads</span><span className="radar-threads-hint">Not run by a bot</span></span>
        {summary ? <span className="radar-threads-summary" data-tone={needs ? "needs" : failed ? "failed" : "unread"}
          aria-label={count === null ? summary : `${summary}, ${count} ${count === 1 ? "thread" : "threads"}`}>{summary}</span>
          : <span className="radar-threads-count" aria-label={count === null ? "loading" : `${count} ${count === 1 ? "thread" : "threads"}`}>{count ?? "…"}</span>}
      </button>
      {open ? (
        <div id={listId} className="radar-threads-list" ref={list} onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
          {count === null ? <p className="radar-threads-empty">Checking which threads are yours…</p>
            : rows.length === 0 ? <p className="radar-threads-empty">Every thread belongs to a bot</p>
            : rows.map(({ thread, depth }) => {
              const mark = markOf(thread);
              const project = claims.projectName.get(thread.projectId);
              const age = shortAgo(thread.latestAttentionAt, now);
              return (
                <ThreadActionsContextMenu key={thread.id} thread={threadActionTarget(thread)}>
                  <div className="radar-thread-item" data-current={thread.id === activeThreadId || undefined} data-menu={menuFor === thread.id || undefined}>
                    <button type="button" className="radar-thread-row" data-rove={thread.id} data-thread-id={thread.id} data-mark={mark} data-depth={depth || undefined}
                      aria-current={thread.id === activeThreadId ? "page" : undefined}
                      aria-label={[thread.displayTitle, MARK_WORDS[mark], project, age].filter(Boolean).join(", ")} title={thread.displayTitle}
                      onClick={() => onOpen(thread.id)}>
                      <span className="radar-thread-copy">
                        <span className="radar-thread-head">
                          <b dir="auto">{thread.displayTitle}</b>
                          {mark !== "none" ? <span className="radar-thread-mark" title={MARK_TITLES[mark]} aria-hidden="true" /> : null}
                        </span>
                        <small>{[project, age].filter(Boolean).join(" · ")}</small>
                      </span>
                    </button>
                    <ThreadActionsMenu thread={threadActionTarget(thread)} side="bottom" align="end" sideOffset={4}
                      onOpenChange={value => setMenuFor(value ? thread.id : null)}
                      trigger={props => <button {...props} type="button" className="radar-thread-more" tabIndex={-1} aria-label={`Actions for ${thread.displayTitle}`} title="Actions"
                        onClick={event => { props.onClick?.(event); event.stopPropagation(); }}>
                        <Icon name="MoreHorizontal" aria-hidden="true" />
                      </button>} />
                  </div>
                </ThreadActionsContextMenu>
              );
            })}
          {onShowAll ? <button type="button" className="radar-threads-all" onClick={onShowAll}>Show all threads<Icon name="ChevronRight" aria-hidden="true" /></button> : null}
        </div>
      ) : null}
    </section>
  );
}
