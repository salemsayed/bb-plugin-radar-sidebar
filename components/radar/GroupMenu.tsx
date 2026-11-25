import { toast } from "sonner";
import type { RosterBot } from "./bots";
import type { useVisibleBots } from "./botVisibility";
import type { GroupMenuAnchor } from "./groupHelpers";
import { RadarMenu } from "./RadarMenu";
import { PROJECT_ORDER_KEY } from "./useListSettings";

type VisibleBots = ReturnType<typeof useVisibleBots>;

/** Right-click on a group header, the Crew header or a bot card. */
export function GroupMenu({
  anchor,
  roster,
  visible,
  hasProjectOrder,
  onExpandAll,
  onCollapseAll,
  onResetProjectOrder,
  onClose,
}: {
  anchor: GroupMenuAnchor;
  roster: readonly RosterBot[];
  visible: VisibleBots;
  hasProjectOrder: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetProjectOrder: () => void;
  onClose: () => void;
}) {
  return (
    <RadarMenu
      x={anchor.x}
      y={anchor.y}
      items={[
        ...(anchor.botKey
          ? [
              {
                kind: "item" as const,
                id: `hide-bot:${anchor.botKey}`,
                label: `Hide ${roster.find((bot) => bot.key === anchor.botKey)?.name ?? "bot"}`,
                icon: "EyeOff",
                // Attention overrides hiding, so Hide would change nothing until the ask or failure is handled.
                ...(visible.isProtected(anchor.botKey)
                  ? {
                      disabled: true,
                      title:
                        "Handle its open question or unread failure before hiding it.",
                    }
                  : {}),
              },
            ]
          : []),
        ...visible.hiddenBots.map((bot) => ({
          kind: "item" as const,
          id: `show-bot:${bot.key}`,
          label: `Show ${bot.name}`,
          icon: "Eye",
        })),
        ...(anchor.botKey || visible.hiddenBots.length > 0
          ? [{ kind: "separator" as const }]
          : []),
        {
          kind: "item",
          id: "expand-all-groups",
          label: "Expand all folders",
          icon: "Expand",
        },
        {
          kind: "item",
          id: "collapse-all-groups",
          label: "Collapse all folders",
          icon: "Collapse",
        },
        ...(hasProjectOrder
          ? [
              { kind: "separator" as const },
              {
                kind: "item" as const,
                id: "reset-project-order",
                label: "Reset project order",
                icon: "ArrowReloadHorizontal",
              },
            ]
          : []),
      ]}
      onSelect={(id) => {
        onClose();
        if (id.startsWith("hide-bot:")) {
          visible.hide(id.slice("hide-bot:".length));
        } else if (id.startsWith("show-bot:")) {
          visible.unhide(id.slice("show-bot:".length));
        } else if (id === "expand-all-groups") {
          onExpandAll();
        } else if (id === "collapse-all-groups") {
          onCollapseAll();
        } else if (id === "reset-project-order") {
          try {
            localStorage.removeItem(PROJECT_ORDER_KEY);
          } catch {
            // Ignore storage failure.
          }
          onResetProjectOrder();
          toast.success("Project order reset to default");
        }
      }}
      onClose={onClose}
    />
  );
}
