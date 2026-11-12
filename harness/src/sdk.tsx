import type { ReactNode } from "react";
import { answerRpc, currentWorld } from "./world";

interface Schema<T> { parse(value: unknown): T }
interface RpcCall<T> { pluginId: string; method: string; input: unknown; outputSchema?: Schema<T> }

const OWN_PLUGIN = "radar-sidebar";

const sdk = {
  plugins: {
    async callRpc<T>({ pluginId, method, input, outputSchema }: RpcCall<T>): Promise<T> {
      const answer = answerRpc(pluginId, method, input);
      return outputSchema ? outputSchema.parse(answer) : answer as T;
    },
  },
  threads: {
    async list({ threadIds }: { threadIds?: readonly string[] }) {
      const world = currentWorld();
      world.calls.push({ plugin: "bb", method: "threads.list", input: threadIds ?? null });
      const rows = world.threadRows;
      return threadIds ? rows.filter(row => threadIds.includes(row.id)) : rows;
    },
  },
};

const rpc = {
  async call(method: string, input: unknown): Promise<unknown> {
    return answerRpc(OWN_PLUGIN, method, input);
  },
};

const navigate = {
  toThread(threadId: string) { announce(`open thread ${threadId}`); },
  openUrl(url: string) { announce(`open ${url}`); },
};

function announce(text: string): void {
  window.dispatchEvent(new CustomEvent("harness:action", { detail: text }));
}

const sidebar = { experimental_archived: null, status: "ready" as const };

export function useSdk() { return sdk; }
export function useRpc() { return rpc; }
export function useBbNavigate() { return navigate; }
export function useBbContext() { return { threadId: null, projectId: null }; }
export function useComposers() { return []; }
export function useSettings() { return {}; }
export function useSidebarSplitLayout() { return { isSplit: false }; }
export function experimental_useRpcQuery() { return { data: undefined, status: "pending" as const }; }
export function experimental_useRpcKeyedQuery() { return { data: undefined, status: "pending" as const }; }
export function experimental_useSidebarThreads() {
  const world = currentWorld();
  return { ...sidebar, threads: world.sidebarThreads, projects: world.projects };
}
export function experimental_useThreadActions() { return currentWorld().threadActions; }
export function experimental_Icon({ name, className }: { name: string; className?: string }) {
  return <span className={className} data-icon-root="" data-harness-icon={name} aria-hidden="true" />;
}
export function experimental_ProviderIcon() { return null; }
export function experimental_ThreadActionsMenu() { return null; }
export function experimental_ThreadActionsContextMenu({ children }: { children?: ReactNode }) { return <>{children}</>; }
export const experimental_THREAD_ACTION_GROUPS = { navigation: "navigation", organize: "organize", lifecycle: "lifecycle" };
export function definePluginApp<T>(setup: T): T { return setup; }
