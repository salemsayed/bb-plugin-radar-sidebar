import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { readStored, writeStored } from "./useListSettings";

export type ListMode = "bots" | "threads";
export const LIST_MODE_KEY = "radar-sidebar:list-mode:v1";

/** Bots or Threads, kept per device: a phone and a desktop each remember their own. */
export function useListMode(): [ListMode, Dispatch<SetStateAction<ListMode>>] {
  const [mode, setMode] = useState<ListMode>(() => readStored<ListMode>(LIST_MODE_KEY, "bots", ["bots", "threads"]));
  useEffect(() => { writeStored(LIST_MODE_KEY, mode); }, [mode]);
  return [mode, setMode];
}

/**
 * The Bots | Threads segmented switch at the top of the list. Switching only
 * changes what the list shows: it never navigates, so the open thread stays
 * open. The Bots half carries the Needs-you count.
 */
export function ListModeSwitch({ mode, onChange, needsCount }: { mode: ListMode; onChange: (mode: ListMode) => void; needsCount: number | null }) {
  return (
    <div className="radar-mode-switch" role="group" aria-label="Show bots or threads">
      <button type="button" className="radar-mode-option" aria-pressed={mode === "bots"}
        aria-label={needsCount ? `Bots, ${needsCount} need${needsCount === 1 ? "s" : ""} you` : "Bots"}
        onClick={() => onChange("bots")}>
        Bots
        {needsCount ? <span className="radar-mode-count" aria-hidden="true">{needsCount}</span> : null}
      </button>
      <button type="button" className="radar-mode-option" aria-pressed={mode === "threads"} onClick={() => onChange("threads")}>
        Threads
      </button>
    </div>
  );
}
