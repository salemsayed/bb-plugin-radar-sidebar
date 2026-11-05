import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { BOT_TAB } from "./BotPanelTab";
import { isClosed } from "@/lib/botTasks";
import { useBotTasks } from "./useBotTasks";

export const botWorkAction: PluginThreadActionRegistration<ReturnType<typeof useBotTasks>["data"]> = {
  id: "bot-work",
  title: "Bot work",
  icon: "Bot",
  group: "open",
  placement: "header",
  useData: () => useBotTasks(true).data,
  item: ({ thread, data, experimental_panel }) => {
    const bot = data?.bots.find(bot => bot.coordinatorThreadId === thread.id);
    if (!bot) return null;
    const count = bot.tasks.filter(task => !isClosed(task.displayState)).length;
    return {
      label: count ? `${count} ${count === 1 ? "task" : "tasks"}` : "No work",
      icon: "Bot",
      run: () => {
        if (!experimental_panel.openTab({ tab: BOT_TAB })) {
          throw new Error("Open the bot's thread to view its work.");
        }
      },
    };
  },
};
