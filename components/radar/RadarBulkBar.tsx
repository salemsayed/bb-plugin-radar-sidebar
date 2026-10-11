import { Icon } from "@/components/ui/icon";

/** The floating dock for acting on a multi-selection. */
export function RadarBulkBar({
  count,
  onClear,
  onArchive,
  onPin,
  onMarkRead,
}: {
  count: number;
  onClear: () => void;
  onArchive: () => void;
  onPin: () => void;
  onMarkRead: () => void;
}) {
  return (
    <div className="radar-bulk-bar" role="toolbar" aria-label="Bulk actions">
      <div className="radar-bulk-summary">
        <span className="radar-bulk-count">
          {count} selected
        </span>
        <button
          type="button"
          className="radar-bulk-clear"
          title="Deselect all (Esc)"
          aria-label="Deselect all"
          onClick={onClear}
        >
          <Icon name="X" aria-hidden="true" />
        </button>
      </div>
      <div className="radar-bulk-actions">
        <button
          type="button"
          className="radar-bulk-btn"
          title="Archive selected (E)"
          onClick={onArchive}
        >
          <Icon name="Archive" aria-hidden="true" />
          <span>Archive</span>
        </button>
        <button
          type="button"
          className="radar-bulk-btn"
          title="Pin / Unpin selected (P)"
          onClick={onPin}
        >
          <Icon name="Pin" aria-hidden="true" />
          <span>Pin</span>
        </button>
        <button
          type="button"
          className="radar-bulk-btn"
          title="Mark selected as read"
          onClick={onMarkRead}
        >
          <Icon name="MailOpen" aria-hidden="true" />
          <span>Read</span>
        </button>
      </div>
    </div>
  );
}
