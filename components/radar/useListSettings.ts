import {
  useEffect,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  swipeActionFromSetting,
} from "@/lib/swipe";

/** Plugin settings, the list's view state and the preferences it persists. */

export type LifecycleFilter = "active" | "archived" | "all";
export type Grouping = "time" | "project" | "section";
export type StatusFilter = "all" | "live" | "waiting" | "unread" | "pinned";
export type DensityMode = "comfortable" | "compact";

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Any status",
  live: "Live",
  waiting: "Waiting",
  unread: "Unread",
  pinned: "Pinned",
};
export const LIFECYCLE_LABELS: Record<LifecycleFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "Archived too",
};

const LIFECYCLE_KEY = "radar-sidebar:lifecycles:v1";
const GROUPING_KEY = "radar-sidebar:grouping:v1";
export const COLLAPSED_KEY = "radar-sidebar:collapsed:v1";
export const COLLAPSED_THREADS_KEY = "radar-sidebar:collapsed-threads:v1";
export const PROJECT_ORDER_KEY = "radar-sidebar:project-order:v1";
const STATUS_FILTER_KEY = "radar-sidebar:status-filter:v1";
const DENSITY_KEY = "radar-sidebar:density:v1";
const LAST_DEFAULT_DENSITY_KEY = "radar-sidebar:last-default-density:v1";
const LAST_TWO_LINE_TITLES_KEY = "radar-sidebar:last-two-line-titles:v1";
const WORKING_OPEN_KEY = "radar-sidebar:working-open:v1";

export function readStored<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // Private browsing or unavailable storage: fall through to the default.
  }
  return fallback;
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore: the preference simply won't persist.
  }
}

export function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Corrupt value: start fresh.
  }
  return [];
}

/** Plugin settings, with the shipped defaults applied while they load. The two
 * that set row height fall back to the value this client last saw instead, so
 * a reload paints rows at their final size without holding the list back.
 * Swipe actions stay off until the settings arrive. */
export function useListSettings() {
  const { values } = useSettings();
  const flag = (key: string, fallback: boolean): boolean =>
    typeof values?.[key] === "boolean" ? (values[key] as boolean) : fallback;
  const [lastSeen] = useState(() => ({
    defaultDensity: readStored<DensityMode>(
      LAST_DEFAULT_DENSITY_KEY,
      "comfortable",
      ["comfortable", "compact"],
    ),
    wrapTitles: readStored(LAST_TWO_LINE_TITLES_KEY, "off", ["off", "on"]) === "on",
  }));
  const loaded = values !== undefined;
  const defaultDensity: DensityMode = loaded
    ? values.defaultDensity === "compact" ? "compact" : "comfortable"
    : lastSeen.defaultDensity;
  const wrapTitles = loaded ? flag("twoLineTitles", false) : lastSeen.wrapTitles;
  // Swipes act on threads, so they wait for the saved choice rather than
  // running on the defaults for someone who turned them off.
  const swipeOn = loaded && flag("swipeActions", true);
  useEffect(() => {
    if (!loaded) return;
    writeStored(LAST_DEFAULT_DENSITY_KEY, defaultDensity);
    writeStored(LAST_TWO_LINE_TITLES_KEY, wrapTitles ? "on" : "off");
  }, [loaded, defaultDensity, wrapTitles]);
  return {
    botRail: flag("botRail", false),
    botsDeck: flag("botsDeck", true),
    needsYouLane: flag("needsYouLane", true),
    nestByOwner: flag("nestByOwner", true),
    hideEmptySections: flag("hideEmptySections", false),
    hideWorking: flag("hideWorking", false),
    hoverCard: flag("hoverCard", true),
    celebrate: flag("celebrate", true),
    motion: flag("motion", true),
    defaultDensity,
    wrapTitles,
    swipeRight: swipeOn
      ? swipeActionFromSetting(values?.swipeRight, DEFAULT_SWIPE_RIGHT)
      : "none",
    swipeLeft: swipeOn
      ? swipeActionFromSetting(values?.swipeLeft, DEFAULT_SWIPE_LEFT)
      : "none",
  };
}

export type ListSettings = ReturnType<typeof useListSettings>;

/**
 * Density is stored as an override: "auto" (or nothing) follows the server
 * `defaultDensity`, an explicit value wins. Toggling back onto the server
 * default clears the override, so the setting becomes authoritative again
 * instead of being locked out forever by one stray click.
 */
export function useDensity(defaultDensity: DensityMode) {
  const [densityOverride, setDensityOverride] = useState<
    DensityMode | "auto"
  >(() => readStored(DENSITY_KEY, "auto", ["auto", "comfortable", "compact"]));
  const density: DensityMode =
    densityOverride === "auto" ? defaultDensity : densityOverride;
  const selectDensity = (next: DensityMode) => {
    const stored = next === defaultDensity ? "auto" : next;
    setDensityOverride(stored);
    writeStored(DENSITY_KEY, stored);
  };
  return { density, selectDensity };
}

/** A set of ids kept in localStorage. It persists from an effect, not from
 * inside the state updaters. */
export function usePersistedSet(
  key: string,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [ids, setIds] = useState<Set<string>>(
    () => new Set(readStringArray(key)),
  );
  useEffect(() => {
    writeStored(key, JSON.stringify([...ids]));
  }, [key, ids]);
  return [ids, setIds];
}

/** The Working drawer starts folded: out of sight is the point. */
export function useWorkingOpen(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [workingOpen, setWorkingOpen] = useState(
    () => readStored(WORKING_OPEN_KEY, "closed", ["closed", "open"]) === "open",
  );
  useEffect(() => {
    writeStored(WORKING_OPEN_KEY, workingOpen ? "open" : "closed");
  }, [workingOpen]);
  return [workingOpen, setWorkingOpen];
}

export interface SavedView {
  id: string;
  name: string;
  query: string;
  statusFilter: StatusFilter;
  lifecycle: LifecycleFilter;
}

/** Query, status, lifecycle and grouping, with the saved view applied. */
export function useListView() {
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(() =>
    readStored(LIFECYCLE_KEY, "active", ["active", "archived", "all"]),
  );
  const [grouping, setGrouping] = useState<Grouping>(() =>
    readStored(GROUPING_KEY, "time", ["time", "project", "section"]),
  );
  const [activeView, setActiveView] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readStored(STATUS_FILTER_KEY, "all", ["all", "live", "waiting", "unread"]),
  );
  // Regrouping remounts every row: run it as a transition so the click
  // itself never freezes, with a subtle dim while the swap lands.
  const [switchPending, startSwitch] = useTransition();

  const selectLifecycle = (next: LifecycleFilter) => {
    if (next === lifecycle) return;
    writeStored(LIFECYCLE_KEY, next);
    startSwitch(() => setLifecycle(next));
  };
  const selectGrouping = (next: Grouping) => {
    if (next === grouping) return;
    writeStored(GROUPING_KEY, next);
    startSwitch(() => setGrouping(next));
  };
  const selectStatus = (next: StatusFilter) => {
    setActiveView(null);
    setStatusFilter(next);
    writeStored(STATUS_FILTER_KEY, next);
  };
  /** Tapping the chosen status again goes back to every status. */
  const toggleStatus = (next: StatusFilter) =>
    selectStatus(statusFilter === next ? "all" : next);
  const selectView = (view: SavedView) => {
    setActiveView({ id: view.id, name: view.name });
    startSwitch(() => {
      setQuery(view.query);
      setStatusFilter(view.statusFilter);
      setLifecycle(view.lifecycle);
    });
    // "pinned" only exists as a view; a reload starts unfiltered.
    writeStored(
      STATUS_FILTER_KEY,
      view.statusFilter === "pinned" ? "all" : view.statusFilter,
    );
    writeStored(LIFECYCLE_KEY, view.lifecycle);
  };
  const clearView = () => {
    setActiveView(null);
    startSwitch(() => {
      setQuery("");
      setStatusFilter("all");
      setLifecycle("active");
    });
    writeStored(STATUS_FILTER_KEY, "all");
    writeStored(LIFECYCLE_KEY, "active");
  };

  return {
    query,
    setQuery,
    lifecycle,
    grouping,
    statusFilter,
    activeView,
    switchPending,
    selectLifecycle,
    selectGrouping,
    selectStatus,
    toggleStatus,
    selectView,
    clearView,
  };
}

export type ListView = ReturnType<typeof useListView>;
