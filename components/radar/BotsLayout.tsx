import { useEffect, useState } from "react";
import { readStored, writeStored } from "./useListSettings";

export type BotsLayout = "current" | "rows" | "needs" | "ledger" | "unfold";

export const BOTS_LAYOUTS: readonly BotsLayout[] = ["current", "rows", "needs", "ledger", "unfold"];

export const BOTS_LAYOUT_LABEL: Record<BotsLayout, string> = {
  current: "Now",
  rows: "Rows",
  needs: "Needs",
  ledger: "Ledger",
  unfold: "Unfold",
};

export const BOTS_LAYOUT_TITLE: Record<BotsLayout, string> = {
  current: "Current board",
  rows: "Two-line rows",
  needs: "Needs first",
  ledger: "Worker ledger",
  unfold: "Unfold in place",
};

const BOTS_LAYOUT_KEY = "radar-sidebar:bots-layout:v1";

export function useBotsLayout(): [BotsLayout, (layout: BotsLayout) => void] {
  const [layout, setLayout] = useState<BotsLayout>(() => readStored(BOTS_LAYOUT_KEY, "current", BOTS_LAYOUTS));
  useEffect(() => { writeStored(BOTS_LAYOUT_KEY, layout); }, [layout]);
  return [layout, setLayout];
}

export function BotsLayoutSwitch({ value, onChange }: { value: BotsLayout; onChange: (layout: BotsLayout) => void }) {
  return <div className="dispatch-layouts" role="group" aria-label="Bots layout">
    {BOTS_LAYOUTS.map(layout => <button key={layout} type="button" className="dispatch-layout-option" aria-pressed={layout === value} aria-label={BOTS_LAYOUT_TITLE[layout]} title={BOTS_LAYOUT_TITLE[layout]} onClick={() => onChange(layout)}>{BOTS_LAYOUT_LABEL[layout]}</button>)}
  </div>;
}
