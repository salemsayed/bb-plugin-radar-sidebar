import { useEffect, useState, type Dispatch, type Ref, type SetStateAction } from "react";
import { readStored, writeStored } from "./useListSettings";

export type ListMode = "bots" | "threads";
export const LIST_MODE_KEY = "radar-sidebar:list-mode:v1";

export function useListMode(): [ListMode, Dispatch<SetStateAction<ListMode>>] {
  const [mode, setMode] = useState<ListMode>(() => readStored<ListMode>(LIST_MODE_KEY, "bots", ["bots", "threads"]));
  useEffect(() => { writeStored(LIST_MODE_KEY, mode); }, [mode]);
  return [mode, setMode];
}

export function ListModeSwitch({ mode, onChange, needsCount, threadsRef }: {
  mode: ListMode; onChange: (mode: ListMode) => void; needsCount: number | null; threadsRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="radar-mode-switch" role="group" aria-label="Show bots or threads">
      <button type="button" className="radar-mode-option" aria-pressed={mode === "bots"}
        aria-label={needsCount ? `Bots, ${needsCount} need${needsCount === 1 ? "s" : ""} you` : "Bots"}
        onClick={() => onChange("bots")}>
        Bots
        {needsCount ? <span className="radar-mode-count" aria-hidden="true">{needsCount}</span> : null}
      </button>
      <button ref={threadsRef} type="button" className="radar-mode-option" aria-pressed={mode === "threads"} onClick={() => onChange("threads")}>
        Threads
      </button>
    </div>
  );
}
