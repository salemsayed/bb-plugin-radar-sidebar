// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). BB owns app navigation; bot shortcuts live in the list.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RemindMePanel, remindMeAction } from "./components/radar/RemindMePanel";
import { CrewWorkspace } from "./components/radar/CrewWorkspace";
import { CrewRailIcon } from "./components/radar/crewSignal";
import "./app.css";
import "./components/radar/crew-workspace.css";
import "./components/radar/needs.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  // The rail icon carries a count of what needs Salem, published by the sidebar list.
  app.experimental_icons.register({ name: "radar-sidebar/crew-live", component: CrewRailIcon });
  app.slots.navPanel({ id: "crew", title: "Crew", icon: "radar-sidebar/crew-live", path: "crew", component: CrewWorkspace });
  app.slots.threadPanelAction({ id: "remind-when", title: "Remind me", icon: "Bell", component: RemindMePanel });
  app.slots.messageAction(remindMeAction);
  app.slots.experimental_threadList({
    id: "radar",
    title: "Radar",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: RadarThreadList,
  });

});
