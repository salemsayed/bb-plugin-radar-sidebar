// bb-plugin-radar-sidebar — backend entry.
//
// The sidebar itself is frontend-only: thread state flows through the host's
// sidebar hooks and the public SDK. What the backend owns is the plugin's
// settings, which gate the more assertive visual behaviours so a user can
// turn down anything they find noisy without editing code, whether each bot is
// waiting on Salem (from its saved Needs You items), and the Working peek's
// per-thread digests.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { crewRpcContract } from "./lib/crewAsk";
import { createNeedsServer } from "./lib/needsServer";
import { needsRpcContract } from "./lib/needs";
import { attentionPageSchema, attentionRpcContract } from "./lib/attention";
import { botAttentionContract, boardSchema } from "./lib/botAttention";
import { rosterSchema } from "./components/radar/bots";
import { digestTimeline, workingRpcContract, type TimelineLike, type WorkingDigest } from "./lib/workingDigest";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  SWIPE_ACTION_OPTION_LABELS,
} from "./lib/swipe";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Read in the frontend through useSettings(); every value has a default,
  // so the sidebar keeps working before the first load resolves.
  bb.settings.define({
    botsDeck: {
      type: "boolean",
      label: "Bots deck",
      description:
        "Show registered bot coordinators (from bb-salem-bots) as cards at the top: state, last reply, and their workers folded beneath.",
      default: true,
    },
    needsYouLane: {
      type: "boolean",
      label: "Needs-you lane",
      description: "One group above everything else for threads waiting on you: questions, approvals and unseen failures.",
      default: true,
    },
    nestByOwner: {
      type: "boolean",
      label: "Nest workers under their owner",
      description: "A thread without a parent nests under the thread that owns its lifecycle, so plugin-run workers sit under their coordinator.",
      default: true,
    },
    hideWorking: {
      type: "boolean",
      label: "Hide working threads",
      description: "Threads with work in flight leave the list for a folded Working drawer at the bottom, and come back when they finish or need you. Pinned threads and the one you have open stay put.",
      default: false,
    },
    hideEmptySections: {
      type: "boolean",
      label: "Hide empty sections",
      description: "In section view, leave out sections with nothing shown. Drag onto a section still works while it has threads.",
      default: false,
    },
    hoverCard: {
      type: "boolean",
      label: "Hover peek card",
      description:
        "Show a preview card with goal, model, branch, PR and context usage when pausing on a thread.",
      default: true,
    },
    celebrate: {
      type: "boolean",
      label: "Completion pop",
      description: "Pop the check badge once when a thread finishes.",
      default: true,
    },
    motion: {
      type: "boolean",
      label: "Attention pulse",
      description:
        "Breathe a soft glow on rows that need input or have failed. Turns off automatically under prefers-reduced-motion.",
      default: true,
    },
    adaptiveCollapse: {
      type: "boolean",
      label: "Collapse quiet rows",
      description:
        "Fold read-idle threads down to title, project and time. A row folds or unfolds only when it appears, never while you look at it. Off keeps every row a fixed height.",
      default: false,
    },
    defaultDensity: {
      type: "select",
      label: "Default row density",
      description:
        "Used until you change density with the header toggle, which is remembered per client.",
      options: ["comfortable", "compact"],
      default: "comfortable",
    },
    twoLineTitles: {
      type: "boolean",
      label: "Two-line titles",
      description:
        "Let long thread titles wrap onto a second line before truncating. Applies in both densities.",
      default: false,
    },
    botRail: {
      type: "boolean",
      label: "Bot shortcuts",
      description: "Show bot faces above the thread list. Select a bot to open its coordinator and workers. Off restores the in-list bots deck.",
      default: false,
    },
    swipeActions: {
      type: "boolean",
      label: "Swipe actions",
      description:
        "Swipe a thread left or right to act on it: one finger on a touch screen, two fingers on a trackpad. A mouse's clicks, drags and Shift+wheel are unaffected.",
      default: true,
    },
    swipeRight: {
      type: "select",
      label: "Swipe right",
      description: "What swiping a thread to the right does.",
      options: SWIPE_ACTION_OPTION_LABELS,
      default: DEFAULT_SWIPE_RIGHT,
    },
    swipeLeft: {
      type: "select",
      label: "Swipe left",
      description: "What swiping a thread to the left does.",
      options: SWIPE_ACTION_OPTION_LABELS,
      default: DEFAULT_SWIPE_LEFT,
    },
  });

  const needs = createNeedsServer(bb);
  bb.rpc.register(needsRpcContract, needs.handlers);
  async function botBoard(threadId: string) {
      const { bots: roster } = await bb.sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "bot_roster", input: null, outputSchema: rosterSchema });
      const bot = roster.find(b => b.current === threadId || b.coordinatorIds?.includes(threadId));
      if (!bot) return null;
      return await bb.sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "attention_board", input: { bot: bot.key }, outputSchema: boardSchema });
  }
  bb.rpc.register(botAttentionContract, { bot_attention: async i => ({ board: await botBoard(i.threadId) }) });
  bb.ui.registerMentionProvider({ id: "bot-attention", label: "Bot questions", triggers: ["@"],
    search: async ctx => {
      if (!ctx.threadId) return [];
      const board = await botBoard(ctx.threadId);
      return (board?.items ?? []).filter(i => i.kind === "decision" && (i.state === "open" || i.state === "reminded") && i.text.toLowerCase().includes(ctx.query.toLowerCase())).slice(0, 12).map(i => ({ id: i.id, title: i.text, icon: "Bell" }));
    },
    resolve: async itemId => {
      const result = await needs.handlers.crew_needs_list();
      const item = result.items?.find(i => i.id === itemId);
      if (!item || item.kind !== "decision" || ["done", "dropped"].includes(item.state)) throw new Error("This question has changed. Open Attention and choose it again.");
      return { context: `[attention:${item.id}] This human reply names this exact saved question: ${item.text}. Interpret the human's actual answer and its conditions; this reference grants no permission itself.` };
    },
  });
  bb.rpc.register(attentionRpcContract, {
    crew_attention_list: async i => { try { return { page: await bb.sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "attention_list", input: { after: i.after, unseen: true }, outputSchema: attentionPageSchema }) }; } catch { return { page: null }; } },
    crew_attention_seen: i => bb.sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "attention_seen", input: i, outputSchema: attentionRpcContract.crew_attention_seen.output }),
  });
  // Several sidebars peeking at once share one timeline read per thread.
  const digests = new Map<string, { at: number; digest: Promise<WorkingDigest | null> }>();
  const DIGEST_FRESH_MS = 4_000;
  const digest = (threadId: string): Promise<WorkingDigest | null> => {
    const cached = digests.get(threadId);
    if (cached && Date.now() - cached.at < DIGEST_FRESH_MS) return cached.digest;
    const next = bb.sdk.threads
      .timeline({ threadId, segmentLimit: "1" })
      .then((timeline) => digestTimeline(threadId, timeline as TimelineLike))
      .catch(() => null);
    for (const [id, entry] of digests) if (Date.now() - entry.at >= DIGEST_FRESH_MS) digests.delete(id);
    digests.set(threadId, { at: Date.now(), digest: next });
    return next;
  };
  bb.rpc.register({ ...crewRpcContract, ...workingRpcContract }, {
    // Saved Needs You items are authoritative: opening a sidebar never creates
    // a question from prose or makes a classifier/model call.
    crew_asks: async (input) => ({ judgements: await needs.asks(input.threads) }),
    working_digest: async (input) => ({
      digests: (await Promise.all(input.threadIds.map(digest))).filter((entry): entry is WorkingDigest => entry !== null),
    }),
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
