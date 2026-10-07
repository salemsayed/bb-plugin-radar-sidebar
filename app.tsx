// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states) and the navigation controls above it (synced to BB's
// own "Customize sidebar" arrangement). Pick them under Settings → Appearance.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RadarNavigation } from "./components/radar/RadarNavigation";
import { RemindMePanel, remindMeAction } from "./components/radar/RemindMePanel";
import "./app.css";
import "./components/radar/needs.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: "remind-when", title: "Remind me", icon: "Bell", component: RemindMePanel });
  app.slots.messageAction(remindMeAction);
  app.slots.experimental_threadList({
    id: "radar",
    title: "Radar",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: RadarThreadList,
  });
  app.slots.experimental_sidebarNavigation({
    id: "radar",
    title: "Radar navigation",
    description: "Compact destination rows that follow BB's own sidebar setup.",
    component: RadarNavigation,
  });
});
