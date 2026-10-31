import { useEffect, useState, type Dispatch, type Ref, type SetStateAction } from "react";
import { readStored, writeStored } from "./useListSettings";

export type ListMode = "bots" | "threads";
export const LIST_MODE_KEY = "radar-sidebar:list-mode:v1";

export function useListMode(): [ListMode, Dispatch<SetStateAction<ListMode>>] {
  const [mode, setMode] = useState<ListMode>(() => readStored<ListMode>(LIST_MODE_KEY, "bots", ["bots", "threads"]));
  useEffect(() => { writeStored(LIST_MODE_KEY, mode); }, [mode]);
  return [mode, setMode];
}

export function ListModeSwitch({ mode, onChange, needsCount, unreadBots = 0, threadsRef }: {
  mode: ListMode; onChange: (mode: ListMode) => void; needsCount: number | null; unreadBots?: number; threadsRef?: Ref<HTMLButtonElement>;
}) {
  const hint = mode !== "bots" && unreadBots > 0;
  const label = ["Bots", needsCount ? `${needsCount} need${needsCount === 1 ? "s" : ""} you` : null, hint ? `${unreadBots} with ${unreadBots === 1 ? "an unread reply" : "unread replies"}` : null].filter(Boolean).join(", ");
  return (
    <div className="radar-mode-switch" role="group" aria-label="Show bots or threads">
      <button type="button" className="radar-mode-option" aria-pressed={mode === "bots"} aria-label={label}
        onClick={() => onChange("bots")}>
        Bots
        {needsCount ? <span className="radar-mode-count" aria-hidden="true">{needsCount}</span> : null}
        {hint ? <span className="radar-mode-dot" aria-hidden="true" /> : null}
      </button>
      <button ref={threadsRef} type="button" className="radar-mode-option" aria-pressed={mode === "threads"} onClick={() => onChange("threads")}>
        Threads
      </button>
    </div>
  );
}
