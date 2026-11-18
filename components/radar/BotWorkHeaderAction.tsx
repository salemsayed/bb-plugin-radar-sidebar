import { useBotRoster } from "./useBotRoster";
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { BOT_TAB } from "./BotPanelTab";
import { isClosed } from "@/lib/botTasks";
import { useBotSidebar } from "./useBotTasks";

export function botWorkLabel(open: number): string {
  return open ? `Bot work: ${open} open ${open === 1 ? "task" : "tasks"}` : "Bot work: nothing open";
}

export const botWorkAction: PluginThreadActionRegistration<ReturnType<typeof useBotSidebar>["data"]> = {
  id: "bot-work",
  title: "Bot work",
  icon: "Bot",
  group: "open",
  placement: "header",
  useData: ({ threadIds }) => {
    const bots = useBotRoster(true).filter(bot => threadIds.includes(bot.current));
    return useBotSidebar(bots.length > 0).data;
  },
  item: ({ thread, data, experimental_panel }) => {
    const bot = data?.bots.find(bot => bot.coordinatorThreadId === thread.id);
    if (!bot) return null;
    const count = bot.tasks.filter(task => !isClosed(task.displayState)).length;
    return {
      label: botWorkLabel(count),
      icon: "Bot",
      run: () => {
        if (!experimental_panel.openTab({ tab: BOT_TAB })) {
          throw new Error("Open the bot's thread to view its work.");
        }
      },
    };
  },
};
