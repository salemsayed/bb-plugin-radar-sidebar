import { useEffect, useState, type Dispatch, type Ref, type SetStateAction } from "react";
import { readStored, writeStored } from "./useListSettings";
import { AUTOMATIONS_ROUTE, onAutomationsRoute } from "./automationsLink";

export type ListMode = "bots" | "threads";
export const LIST_MODE_KEY = "radar-sidebar:list-mode:v1";

/** Bots or Threads, kept per device: a phone and a desktop each remember their own. */
export function useListMode(): [ListMode, Dispatch<SetStateAction<ListMode>>] {
  const [mode, setMode] = useState<ListMode>(() => readStored<ListMode>(LIST_MODE_KEY, "bots", ["bots", "threads"]));
  useEffect(() => { writeStored(LIST_MODE_KEY, mode); }, [mode]);
  return [mode, setMode];
}

export function ListModeSwitch({ mode, onChange, needsCount, threadsRef, routePath }: {
  mode: ListMode; onChange: (mode: ListMode) => void; needsCount: number | null; threadsRef?: Ref<HTMLButtonElement>; routePath?: string;
}) {
  const automationsOpen = onAutomationsRoute(routePath);
  return (
    <div className="radar-mode-switch" role="group" aria-label="Show bots or threads, or open automations" data-route={automationsOpen ? "automations" : undefined}>
      <button type="button" className="radar-mode-option" aria-pressed={mode === "bots"}
        aria-label={needsCount ? `Bots, ${needsCount} need${needsCount === 1 ? "s" : ""} you` : "Bots"}
        onClick={() => onChange("bots")}>
        Bots
        {needsCount ? <span className="radar-mode-count" aria-hidden="true">{needsCount}</span> : null}
      </button>
      <button ref={threadsRef} type="button" className="radar-mode-option" aria-pressed={mode === "threads"} onClick={() => onChange("threads")}>
        Threads
      </button>
      <a className="radar-mode-option radar-mode-link" href={AUTOMATIONS_ROUTE} aria-current={automationsOpen ? "page" : undefined}>Automations</a>
    </div>
  );
}
