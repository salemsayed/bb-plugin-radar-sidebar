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

/** "all" is active plus archived: the panel's Archived toggle. */
export type LifecycleFilter = "active" | "all";
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
  all: "Archived",
};

const LIFECYCLE_KEY = "radar-sidebar:lifecycles:v1";
export const COLLAPSED_KEY = "radar-sidebar:collapsed:v1";
export const COLLAPSED_THREADS_KEY = "radar-sidebar:collapsed-threads:v1";
export const PROJECT_ORDER_KEY = "radar-sidebar:project-order:v1";
const STATUS_FILTER_KEY = "radar-sidebar:status-filter:v1";
const LAST_DEFAULT_DENSITY_KEY = "radar-sidebar:last-default-density:v1";
const LAST_TWO_LINE_TITLES_KEY = "radar-sidebar:last-two-line-titles:v1";
const LAST_GROUPING_KEY = "radar-sidebar:last-grouping:v1";
const WORKING_OPEN_KEY = "radar-sidebar:working-open:v1";
export const NEEDS_LANE_OPEN_KEY = "radar-sidebar:needs-lane-open:v1";
export const SHOW_HIDDEN_KEY = "radar-sidebar:show-hidden:v1";

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

/** Plugin settings, with the shipped defaults applied while they load. The
 * three that shape the list (row density, two-line titles, grouping) fall back
 * to the value this client last saw instead, so a reload paints the list at
 * its final layout without holding it back. Swipe actions stay off until the
 * settings arrive. */
export function useListSettings() {
  const { values } = useSettings();
  const flag = (key: string, fallback: boolean): boolean =>
    typeof values?.[key] === "boolean" ? (values[key] as boolean) : fallback;
  const [lastSeen] = useState(() => ({
    density: readStored<DensityMode>(
      LAST_DEFAULT_DENSITY_KEY,
      "comfortable",
      ["comfortable", "compact"],
    ),
    wrapTitles: readStored(LAST_TWO_LINE_TITLES_KEY, "off", ["off", "on"]) === "on",
    grouping: readStored<Grouping>(LAST_GROUPING_KEY, "time", ["time", "project", "section"]),
  }));
  const loaded = values !== undefined;
  const density: DensityMode = loaded
    ? values.defaultDensity === "compact" ? "compact" : "comfortable"
    : lastSeen.density;
  const wrapTitles = loaded ? flag("twoLineTitles", false) : lastSeen.wrapTitles;
  const grouping: Grouping = loaded
    ? values.grouping === "project" || values.grouping === "section" ? values.grouping : "time"
    : lastSeen.grouping;
  // Swipes act on threads, so they wait for the saved choice rather than
  // running on the defaults for someone who turned them off.
  const swipeOn = loaded && flag("swipeActions", true);
  useEffect(() => {
    if (!loaded) return;
    writeStored(LAST_DEFAULT_DENSITY_KEY, density);
    writeStored(LAST_TWO_LINE_TITLES_KEY, wrapTitles ? "on" : "off");
    writeStored(LAST_GROUPING_KEY, grouping);
  }, [loaded, density, wrapTitles, grouping]);
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
    density,
    grouping,
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

/** In the All view the Needs-you lane starts folded to one row, so it never
 * pushes the threads down; the choice is remembered per client. */
export function useNeedsLaneOpen(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpen] = useState(
    () => readStored(NEEDS_LANE_OPEN_KEY, "closed", ["closed", "open"]) === "open",
  );
  useEffect(() => {
    writeStored(NEEDS_LANE_OPEN_KEY, open ? "open" : "closed");
  }, [open]);
  return [open, setOpen];
}

/** Hidden workers stay out of the list unless this client asked to see them.
 * The host's thread array already carries them, so the switch never refetches. */
export function useShowHidden(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [showHidden, setShowHidden] = useState(
    () => readStored(SHOW_HIDDEN_KEY, "off", ["off", "on"]) === "on",
  );
  useEffect(() => {
    writeStored(SHOW_HIDDEN_KEY, showHidden ? "on" : "off");
  }, [showHidden]);
  return [showHidden, setShowHidden];
}

/** Query, status filter and lifecycle, as this client last left them. */
export function useListView() {
  const [query, setQuery] = useState("");
  // Older clients could store "archived" (archived only); it now means "all".
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(() =>
    readStored(LIFECYCLE_KEY, "active", ["active", "archived", "all"]) === "active"
      ? "active"
      : "all",
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readStored(STATUS_FILTER_KEY, "all", ["all", "live", "waiting", "unread", "pinned"]),
  );
  // A lifecycle switch refetches and remounts every row: run it as a
  // transition so the click itself never freezes, with a subtle dim while
  // the swap lands.
  const [switchPending, startSwitch] = useTransition();

  const selectLifecycle = (next: LifecycleFilter) => {
    if (next === lifecycle) return;
    writeStored(LIFECYCLE_KEY, next);
    startSwitch(() => setLifecycle(next));
  };
  const selectStatus = (next: StatusFilter) => {
    setStatusFilter(next);
    writeStored(STATUS_FILTER_KEY, next);
  };
  /** Tapping the chosen status again goes back to every status. */
  const toggleStatus = (next: StatusFilter) =>
    selectStatus(statusFilter === next ? "all" : next);

  return {
    query,
    setQuery,
    lifecycle,
    statusFilter,
    switchPending,
    selectLifecycle,
    selectStatus,
    toggleStatus,
  };
}

export type ListView = ReturnType<typeof useListView>;
