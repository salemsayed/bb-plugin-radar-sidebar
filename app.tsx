// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). BB owns app navigation; bot shortcuts live in the list.
// Saved bot asks and alerts show in the list's Needs-you lane: there is no
// separate Attention panel or Crew page.
import { ThreadPresence } from "./lib/ThreadPresence";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RemindMePanel, remindMeAction } from "./components/radar/RemindMePanel";
import "./app.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "thread-presence", component: ThreadPresence });
  // Same id as the retired threadPanelAction, so saved tabs and remindMeAction's openPanel({ actionId }) still match.
  app.slots.experimental_tab({ context: { kind: "thread" }, availability: "action", id: "remind-when", title: "Remind me", icon: "Bell", component: RemindMePanel });
  app.slots.messageAction(remindMeAction);
  app.slots.experimental_threadList({
    id: "radar",
    title: "Radar",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: RadarThreadList,
  });

});
