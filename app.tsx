// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). BB owns app navigation; bot shortcuts live in the list.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RemindMePanel, remindMeAction } from "./components/radar/RemindMePanel";
import { BotAttentionHeader, BotAttentionPanel } from "./components/radar/BotAttentionPanel";
import "./app.css";
import "./components/radar/crew-workspace.css";
import "./components/radar/needs.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: "bot-attention", title: "Attention", icon: "Bell", component: BotAttentionPanel });
  app.slots.experimental_threadHeaderAction({ id: "bot-attention", title: "Bot attention", component: BotAttentionHeader });
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
