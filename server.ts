// bb-plugin-radar-sidebar — backend entry.
//
// The sidebar itself is frontend-only: thread state flows through the host's
// sidebar hooks and the public SDK. What the backend owns is the plugin's
// settings, which gate the more assertive visual behaviours so a user can
// turn down anything they find noisy without editing code, the crew view's
// judgement of whether each bot is waiting on Salem, and the Working peek's
// per-thread digests.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { crewRpcContract } from "./lib/crewAsk";
import { createCrewJudge } from "./lib/crewJudge";
import { createNeedsAskRecorder } from "./lib/needsAsk";
import { createNeedsServer } from "./lib/needsServer";
import { needsRpcContract } from "./lib/needs";
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
    loudUnread: {
      type: "boolean",
      label: "Loud unread rows",
      description:
        "Tinted wash and accent bar on finished-but-unseen threads. Off keeps the check icon and unread pip only.",
      default: true,
    },
    adaptiveCollapse: {
      type: "boolean",
      label: "Collapse quiet rows",
      description:
        "Fold read-idle threads down to title, project and time so rows that matter stand out.",
      default: true,
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
    railNav: {
      type: "boolean",
      label: "Navigation rail",
      description:
        "Show a vertical navigation rail beside the thread list on desktop and mobile. Off keeps navigation above the list.",
      default: false,
    },
    botRail: {
      type: "boolean",
      label: "Bot rail (experimental)",
      description: "Requires Navigation rail. Replace the in-list bots deck with bot faces: tap to show their workers, then open the coordinator from the heading. Coordinators and workers tuck into the rail. Off restores the full list. Project tiles stay removed in both modes.",
      default: false,
    },
    wideRail: {
      type: "boolean",
      label: "Labelled rail (experimental)",
      description:
        "Requires Navigation rail. Adds a toggle at the foot of the navigation rail that widens it to show labels, including BB's own footer actions. Experimental: uses BB's sidebar layout and falls back to icons when the expected layout is unavailable.",
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
  const judge = createCrewJudge(bb, Date.now, createNeedsAskRecorder(bb));
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
    crew_asks: async (input) => {
      // The client just saw these reply versions: a newer one may be the acknowledgment that closes a saved decision.
      void needs.observe(input.threads);
      return { judgements: await judge(input.threads) };
    },
    working_digest: async (input) => ({
      digests: (await Promise.all(input.threadIds.map(digest))).filter((entry): entry is WorkingDigest => entry !== null),
    }),
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
