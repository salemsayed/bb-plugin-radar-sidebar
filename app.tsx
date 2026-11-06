import { primeScrollRoute } from "./lib/primeScrollRoute";
// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). BB owns app navigation; bot shortcuts live in the list.
// Saved bot asks and alerts show in the list's Needs-you lane: there is no
// separate Attention panel or Crew page.
import { ThreadPresence } from "./lib/ThreadPresence";
import { AskStrip } from "./components/radar/AskStrip";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RemindMePanel, remindMeAction } from "./components/radar/RemindMePanel";
import { botWorkAction } from "./components/radar/BotWorkHeaderAction";
import { BotPanelTab, BOT_TAB, useIsBotThread } from "./components/radar/BotPanelTab";
import "./app.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();
primeScrollRoute();

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "thread-presence", component: ThreadPresence });
  app.slots.experimental_appOverlay({ id: "ask-strip", component: AskStrip });
  app.slots.experimental_tab({ context: { kind: "thread" }, availability: "action", id: "remind-when", title: "Remind me", icon: "Bell", component: RemindMePanel });
  app.slots.messageAction(remindMeAction);
  app.slots.experimental_threadAction(botWorkAction);
  app.slots.experimental_tab({ ...BOT_TAB, title: "Bot", icon: "Bot", layout: "flush", useVisible: useIsBotThread, component: BotPanelTab });
  app.slots.experimental_threadList({
    id: "radar",
    title: "Radar",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: RadarThreadList,
  });

});
