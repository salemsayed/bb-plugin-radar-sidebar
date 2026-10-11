import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { StatusFilter } from "./useListSettings";

/** Skeleton rows while the host loads the thread list. */
export function RadarListLoading() {
  return (
    <div className="radar-state" role="status" aria-label="Loading threads">
      {Array.from({ length: 8 }, (_, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} className="radar-skeleton" aria-hidden="true">
          <span className="radar-skeleton-title" />
          <span className="radar-skeleton-subtitle" />
        </div>
      ))}
    </div>
  );
}

export function RadarListError() {
  return (
    <div className="radar-state" role="alert">
      <div className="radar-empty">
        <Icon name="AlertCircle" aria-hidden="true" />
        <p>Couldn’t load threads.</p>
        <p className="radar-empty-hint">
          Check your connection — the list refreshes automatically.
        </p>
      </div>
    </div>
  );
}

/** Nothing to show: no threads, nothing matching, or an empty bot view. */
export function RadarListEmpty({
  query,
  statusFilter,
  scopedBotName,
  onOpenScopedBot,
}: {
  query: string;
  statusFilter: StatusFilter;
  scopedBotName: string | null;
  onOpenScopedBot: () => void;
}) {
  return (
    <div className="radar-state" role="status">
      <div className="radar-empty">
        <Icon name="MessageSquare" aria-hidden="true" />
        {query.trim() === "" ? (
          statusFilter !== "all" ? (
            <>
              <p>
                No{" "}
                {statusFilter === "live"
                  ? "live"
                  : statusFilter === "waiting"
                    ? "waiting"
                    : statusFilter === "pinned"
                      ? "pinned"
                      : "unread"}{" "}
                threads.
              </p>
              <p className="radar-empty-hint">
                Clear the filter under the search, or pick another status.
              </p>
            </>
          ) : (
            <>
              <p>{scopedBotName !== null ? "No worker threads." : "No threads yet."}</p>
              {scopedBotName !== null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenScopedBot}
                >
                  Open {scopedBotName}
                </Button>
              ) : (
                <p className="radar-empty-hint">Start one with + above.</p>
              )}
            </>
          )
        ) : (
          <>
            <p>No threads match “{query.trim()}”.</p>
            <p className="radar-empty-hint">
              Try fewer words or a different filter.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Archived threads arrive in pages. */
export function RadarArchivedPager({
  archived,
}: {
  archived: NonNullable<PluginSidebarThreadsState["experimental_archived"]>;
}) {
  return (
    <div className="radar-more">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={archived.isFetchingNextPage}
        onClick={() => {
          archived.fetchNextPage().catch(() => {
            toast.error("Couldn’t load more threads.");
          });
        }}
      >
        {archived.isFetchingNextPage
          ? "Loading…"
          : archived.isFetchNextPageError
            ? "Retry loading more"
            : "Show more"}
      </Button>
    </div>
  );
}
