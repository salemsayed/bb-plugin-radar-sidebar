import { Icon } from "@/components/ui/icon";
import type { StaleNote } from "./NeedsSummary";

export function StaleLine({ stale, className }: { stale: StaleNote; className?: string }) {
  return <p className={`radar-stale-line${className ? ` ${className}` : ""}`} role="status" title={`Can't refresh the bots. Showing what we had at ${stale.asOf}`}>
    <Icon name="AlertCircle" aria-hidden="true" className="radar-stale-line-icon" />
    <span className="radar-stale-line-text">Can't refresh · showing {stale.asOf}</span>
    <button type="button" className="radar-stale-line-retry" disabled={stale.retrying} aria-label={stale.retrying ? "Trying to reach the bots" : `Retry: showing what we had at ${stale.asOf}`} onClick={stale.onRetry}>{stale.retrying ? "Trying…" : "Retry"}</button>
  </p>;
}
