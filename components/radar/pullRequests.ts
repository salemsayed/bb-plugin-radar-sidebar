import { experimental_useRpcKeyedQuery, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

// bb 0.47 moved pull request data to the bundled GitHub PR Status plugin; this is the part of
// its `pullRequests` contract the rows read. Keys are environment ids.
const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["draft", "open", "merged", "closed"]),
  attention: z.string(),
});
export type RowPullRequest = z.infer<typeof pullRequestSchema>;

const githubPrStatus = {
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("available"), pullRequest: pullRequestSchema }),
      z.object({ outcome: z.literal("absent") }),
      z.object({ outcome: z.literal("unavailable"), message: z.string() }),
    ])),
  },
} as const;

/** The thread's environment pull request; null while loading, absent, unavailable or on a query error. */
export function useRowPullRequest(thread: PluginSidebarThread): RowPullRequest | null {
  const environmentId = thread.environment?.id;
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: "bb--github-pr-status",
    contract: githubPrStatus,
    method: "pullRequests",
    keys: environmentId ? [environmentId] : [],
  });
  const row = environmentId ? data?.[environmentId] : undefined;
  return row?.outcome === "available" ? row.pullRequest : null;
}
