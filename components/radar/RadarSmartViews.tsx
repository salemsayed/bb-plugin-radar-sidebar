import { useState, useRef, useEffect } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { StatusFilter } from "./useListSettings";

export interface CustomSmartView {
  id: string;
  name: string;
  query: string;
  statusFilter: StatusFilter;
  lifecycle: "all" | "active" | "archived";
  createdAt: number;
}

const SMART_VIEWS_STORAGE_KEY = "radar-sidebar:smart-views:v1";

const STATUS_FILTERS: readonly string[] = [
  "all",
  "live",
  "waiting",
  "unread",
  "pinned",
];
const LIFECYCLES: readonly string[] = ["all", "active", "archived"];

function isSmartView(value: unknown): value is CustomSmartView {
  if (typeof value !== "object" || value === null) return false;
  const view = value as Record<string, unknown>;
  return (
    typeof view.id === "string" &&
    typeof view.name === "string" &&
    typeof view.query === "string" &&
    typeof view.statusFilter === "string" &&
    STATUS_FILTERS.includes(view.statusFilter) &&
    typeof view.lifecycle === "string" &&
    LIFECYCLES.includes(view.lifecycle) &&
    typeof view.createdAt === "number"
  );
}

export function loadSavedSmartViews(): CustomSmartView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SMART_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything malformed is dropped rather than crashing the list.
    return Array.isArray(parsed) ? parsed.filter(isSmartView) : [];
  } catch {
    return [];
  }
}

export function saveSmartViewsToStorage(views: CustomSmartView[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SMART_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Ignore storage quota
  }
}

export function RadarSmartViews({
  activeViewId,
  currentQuery,
  currentStatusFilter,
  currentLifecycle,
  onSelectView,
  onClearView,
  counts,
}: {
  activeViewId: string | null;
  currentQuery: string;
  currentStatusFilter: StatusFilter;
  currentLifecycle: "all" | "active" | "archived";
  onSelectView: (view: {
    id: string;
    name: string;
    query: string;
    statusFilter: StatusFilter;
    lifecycle: "all" | "active" | "archived";
  }) => void;
  onClearView: () => void;
  counts: {
    pinned: number;
    live: number;
    waiting: number;
    unread: number;
  };
}) {
  const [customViews, setCustomViews] = useState<CustomSmartView[]>(() =>
    loadSavedSmartViews(),
  );
  const [isNamingNewView, setIsNamingNewView] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNamingNewView) {
      inputRef.current?.focus();
    }
  }, [isNamingNewView]);

  const handleSaveCurrentView = () => {
    const trimmed = newViewName.trim();
    if (!trimmed) {
      setIsNamingNewView(false);
      return;
    }
    const newView: CustomSmartView = {
      id: `custom_${Date.now()}`,
      name: trimmed,
      query: currentQuery,
      statusFilter: currentStatusFilter,
      lifecycle: currentLifecycle,
      createdAt: Date.now(),
    };
    const next = [...customViews, newView];
    setCustomViews(next);
    saveSmartViewsToStorage(next);
    setIsNamingNewView(false);
    setNewViewName("");
    onSelectView(newView);
    toast.success(`Saved smart view "${trimmed}"`);
  };

  const handleDeleteView = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = customViews.filter((v) => v.id !== id);
    setCustomViews(next);
    saveSmartViewsToStorage(next);
    if (activeViewId === id) {
      onClearView();
    }
    toast.success(`Removed view "${name}"`);
  };

  const hasFilterActive =
    currentQuery.trim() !== "" ||
    currentStatusFilter !== "all" ||
    currentLifecycle !== "active";

  return (
    <div className="radar-smart-views-bar" role="toolbar" aria-label="Smart views">
      <div className="radar-smart-views-scroll">
        {/* Preset views */}
        <button
          type="button"
          className={cn(
            "radar-smart-view-pill",
            activeViewId === "preset_pinned" && "radar-smart-view-active",
          )}
          onClick={() => {
            if (activeViewId === "preset_pinned") {
              onClearView();
            } else {
              onSelectView({
                id: "preset_pinned",
                name: "Pinned",
                query: "",
                statusFilter: "pinned",
                lifecycle: "active",
              });
            }
          }}
          title="Pinned threads"
        >
          <Icon name="Pin" aria-hidden="true" />
          <span>Pinned</span>
          {counts.pinned > 0 ? (
            <span className="radar-smart-view-count">{counts.pinned}</span>
          ) : null}
        </button>

        {/* User-saved custom views */}
        {customViews.map((view) => {
          const isActive = activeViewId === view.id;
          return (
            /* Wrapper holds two real buttons: an interactive <span> inside a
               <button> is invalid HTML and unreachable for keyboard/AT users. */
            <span key={view.id} className="radar-smart-view-group">
              <button
                type="button"
                className={cn(
                  "radar-smart-view-pill radar-smart-view-custom",
                  isActive && "radar-smart-view-active",
                )}
                onClick={() => {
                  if (isActive) {
                    onClearView();
                  } else {
                    onSelectView(view);
                  }
                }}
                title={`Query: "${view.query || "*"}" · Status: ${view.statusFilter} · Lifecycle: ${view.lifecycle}`}
              >
                <Icon name="Star" aria-hidden="true" />
                <span>{view.name}</span>
              </button>
              <button
                type="button"
                className="radar-smart-view-del"
                aria-label={`Delete view ${view.name}`}
                title={`Delete ${view.name}`}
                onClick={(event) => handleDeleteView(view.id, view.name, event)}
              >
                <Icon name="X" aria-hidden="true" />
              </button>
            </span>
          );
        })}

        {/* Save Current View Trigger or Input */}
        {isNamingNewView ? (
          <form
            className="radar-smart-view-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveCurrentView();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="radar-smart-view-input"
              placeholder="Name view…"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsNamingNewView(false);
                  setNewViewName("");
                }
              }}
            />
            <button
              type="submit"
              className="radar-smart-view-save-btn"
              title="Save view"
            >
              <Icon name="Check" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="radar-smart-view-cancel-btn"
              title="Cancel"
              onClick={() => {
                setIsNamingNewView(false);
                setNewViewName("");
              }}
            >
              <Icon name="X" aria-hidden="true" />
            </button>
          </form>
        ) : hasFilterActive ? (
          <button
            type="button"
            className="radar-smart-view-add"
            onClick={() => {
              setIsNamingNewView(true);
              setNewViewName(
                currentQuery.trim()
                  ? currentQuery.trim().slice(0, 16)
                  : `${currentStatusFilter} view`,
              );
            }}
            title="Save current filters as a named Smart View"
          >
            <Icon name="Plus" aria-hidden="true" />
            <span>Save view</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
