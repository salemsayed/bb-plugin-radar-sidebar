import { useEffect, useId, useRef, useState } from "react";
import { experimental_useThreadActions as useThreadActions, type PluginThreadActionEntry, type PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";

const HIDDEN = new Set(["bb--core/pin", "bb--core/rename", "bb--core/regenerateTitle", "bb--core/archive", "bb--core/delete", "bb--core/parentNotifications"]);

export function botMenuEntries(entries: readonly PluginThreadActionEntry[]): PluginThreadActionEntry[] {
  return entries.filter(entry => !HIDDEN.has(entry.key) && entry.group !== "lifecycle" && entry.action.variant !== "destructive");
}

export function BotMenu({ thread, botName, onShowThreads, onClose }: {
  thread: PluginThreadActionTarget;
  botName: string;
  onShowThreads: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [choicesFor, setChoicesFor] = useState<string | null>(null);
  const entries = botMenuEntries(useThreadActions(thread));
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role=menuitem], [role=menuitemradio]")?.focus();
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  const close = () => { setOpen(false); setChoicesFor(null); trigger.current?.focus(); };
  const items = (): HTMLElement[] => Array.from(root.current?.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]") ?? []);
  const move = (step: number) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    list[(at + step + list.length) % list.length]?.focus();
  };
  let group = "";
  return <div className="bot-menu" ref={root}>
    <button ref={trigger} type="button" className="dispatch-more" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={() => { setOpen(value => !value); setChoicesFor(null); }}>
      <Icon name="MoreHorizontal" aria-hidden="true" />More
    </button>
    {open ? <div id={listId} className="bot-menu-list" role="menu" aria-label={`More for ${botName}`}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        if (event.key === "Tab") setOpen(false);
      }}>
      {entries.map(entry => {
        const separator = group !== "" && entry.group !== group;
        group = entry.group;
        const { action } = entry;
        const expanded = choicesFor === entry.key;
        return <div key={entry.key} role="none">
          {separator ? <div className="bot-menu-separator" role="separator" /> : null}
          <button type="button" role="menuitem" className="bot-menu-item" disabled={action.disabled} aria-expanded={action.choices ? expanded : undefined}
            onClick={() => {
              if (action.choices) { setChoicesFor(expanded ? null : entry.key); return; }
              close();
              void action.run();
            }}>
            <span className="bot-menu-label">{action.label}{action.detail ? <small>{action.detail}</small> : null}</span>
            {action.choices ? <Icon name="ChevronRight" aria-hidden="true" className="bot-menu-chevron" data-open={expanded || undefined} /> : null}
          </button>
          {action.choices && expanded ? <div role="group" aria-label={action.choices.heading ?? action.label} className="bot-menu-choices">
            {action.choices.items.map(choice => <button key={choice.id} type="button" role="menuitemradio" aria-checked={!!choice.selected} disabled={choice.disabled} className="bot-menu-item bot-menu-choice"
              onClick={() => { close(); void action.run(choice.id); }}>
              <span className="bot-menu-check" aria-hidden="true">{choice.selected ? <Icon name="Check" /> : null}</span>
              <span className="bot-menu-label">{choice.label}</span>
            </button>)}
            {action.choices.hint ? <p className="bot-menu-hint">{action.choices.hint}</p> : null}
          </div> : null}
        </div>;
      })}
      {entries.length ? <div className="bot-menu-separator" role="separator" /> : null}
      <button type="button" role="menuitem" className="bot-menu-item" onClick={() => { setOpen(false); onShowThreads(); onClose(); }}>
        <span className="bot-menu-label">All threads</span>
      </button>
    </div> : null}
  </div>;
}
