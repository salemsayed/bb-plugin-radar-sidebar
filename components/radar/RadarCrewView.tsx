import { useMemo, useState } from "react";
import { experimental_useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useVisibleBots } from "./botVisibility";
import { BotAvatar } from "./BotAvatar";
import { BotFace } from "./BotFace";
import { coordinatorAsk, shortBotName, STATE_LABELS, type BotState, type RosterBot } from "./bots";
import { botFamily, botWorkers, rosterRefreshKey } from "./botScope";
import { withoutListedAsks, crewFeed, crewRow, shortAgo, type CrewFeedItem, type CrewRow } from "./crew";
import { useCrewArchivedJobs, useCrewAutomations, useCrewJudgements } from "./useCrewData";
import { useThreadPulses } from "./useThreadPulses";
import { isRunningThread } from "./time";
import { NeedsYouList } from "./NeedsYouList";
import { needsChanged, type NeedsYouData } from "@/lib/needsClient";

const FEED_PREVIEW = 5;
const LINE_STATE: Record<CrewRow["line"]["tone"], BotState> = {
  ask: "decision", failed: "failed", running: "working", queued: "queued", rollover: "rollover", unavailable: "unavailable", new: "unread", quiet: "idle",
};
const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

/** Cross-bot inbox, stable roster, then today's work. Details open on demand. */
export function RadarCrewView({ roster: fullRoster, now, onNavigate, needs }: {
  roster: readonly RosterBot[]; now: number; onNavigate: () => void; needs: NeedsYouData;
}) {
  const { threads } = experimental_useSidebarThreads();
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const navigate = useBbNavigate();
  const coordinators = useMemo(() => threads.filter(thread => fullRoster.some(bot => bot.current === thread.id)), [threads, fullRoster]);
  const pulses = useThreadPulses(coordinators, true);
  const automations = useCrewAutomations();
  const judgements = useCrewJudgements(coordinators);
  const asking = useMemo(() => {
    const keys = new Set((needs.items ?? []).filter(item => item.state !== "done" && item.state !== "dropped").map(item => item.bot));
    for (const bot of fullRoster) {
      const thread = coordinators.find(thread => thread.id === bot.current);
      if (thread && coordinatorAsk(thread, pulses.get(thread.id) ?? null, judgements.get(thread.id))) keys.add(bot.key);
      if (needs.items === null) keys.add(bot.key);
    }
    return keys;
  }, [fullRoster, coordinators, pulses, judgements, needs.items]);
  const visibility = useVisibleBots(fullRoster, threads, asking);
  const roster = visibility.bots;
  const rows = useMemo(() => roster.map(bot => crewRow({
    bot, threads, pulse: pulses.get(bot.current) ?? null, judgement: judgements.get(bot.current) ?? null, automations, now,
  })), [roster, threads, pulses, judgements, automations, now]);
  const unlisted = useMemo(() => new Set(withoutListedAsks(rows, needs.items ?? []).map(row => row.bot.key)), [rows, needs.items]);
  const refreshKey = useMemo(() => rosterRefreshKey(threads), [threads]);
  const archived = useCrewArchivedJobs(useMemo(() => roster.map(bot => bot.current), [roster]), refreshKey);
  const feed = useMemo(() => crewFeed({ roster, threads, archived, now }), [roster, threads, archived, now]);
  const [feedOpen, setFeedOpen] = useState(false);
  const liveWorkers = roster.flatMap(bot => botWorkers(threads, bot)).filter(isRunningThread).length;
  const open = (threadId: string) => { navigate.toThread(threadId); onNavigate(); };

  const renderMate = (row: CrewRow) => {
    const { bot, line } = row;
    const affected = threads.find(thread => thread.id === line.threadId);
    const state = line.tone === "ask" && (affected?.hasPendingInteraction || affected?.indicator === "waiting-for-input") ? "needs-you" : LINE_STATE[line.tone];
    const label = STATE_LABELS[state];
    const listed = !unlisted.has(bot.key);
    const summary = listed ? "Waiting on your answer above" : line.text;
    const family = botFamily(threads, bot);
    const unread = family.some(thread => thread.isUnread);
    const target = state === "unread" ? family.find(thread => thread.id === bot.current && thread.isUnread)?.id ?? family.find(thread => thread.isUnread)?.id ?? line.threadId : line.threadId;
    return <li key={bot.key} data-bot={bot.key}>
      <button type="button" className={`radar-crew-mate radar-crew-mate-${state}${unread ? " radar-crew-mate-has-unread" : ""}`} onClick={() => open(target)}
        aria-label={`${shortBotName(bot.name)}, ${label.text}: ${label.action}. ${summary}${row.more ? `, and ${row.more} more` : ""}`} title={label.description}>
        <BotAvatar botKey={bot.key} name={bot.name} state={state} unread={unread} />
        <span className="radar-crew-mate-copy">
          <span className="radar-crew-mate-head"><strong>{shortBotName(bot.name)}</strong>
            {state !== "idle" ? <span className={cn("radar-crew-mate-state", label.tone)}>{label.text}</span> : null}
            {line.at !== null ? <span className="radar-crew-when">{shortAgo(line.at, now)}</span> : null}
          </span>
          <span className="radar-crew-mate-summary">{summary}</span>
          {row.context !== null && row.context >= 0.75 ? <span className="radar-crew-mate-context">Context {Math.round(row.context * 100)}%</span> : null}
        </span>
      </button>
    </li>;
  };
  const renderJob = (item: CrewFeedItem) => <li key={item.id}>
    <button type="button" className={`radar-crew-job radar-crew-job-${item.state}`} onClick={() => open(item.id)}
      aria-label={`${shortBotName(item.bot.name)}: ${item.title}, ${item.state}, started ${clockFormatter.format(item.startedAt)}`} title={item.title}>
      <span className="radar-crew-job-time">{clockFormatter.format(item.startedAt)}</span>
      <span className="radar-crew-job-face" aria-hidden="true"><BotFace botKey={item.bot.key} name={item.bot.name} size={14} /></span>
      <span className="radar-crew-job-title">{item.title}</span>
      <span className="radar-crew-job-mark" aria-hidden="true">{item.state === "running" ? <span className="radar-crew-job-spin" /> : item.state === "queued" ? "◷" : item.state === "failed" ? "✕" : "✓"}</span>
    </button>
  </li>;
  const running = feed.filter(item => item.state === "running").length;
  const failed = feed.filter(item => item.state === "failed").length;
  return <div className="radar-crew-view">
    {needs.items === null ? <p role="status" className="radar-crew-needs-status">
      {needs.status === "loading" ? "Loading saved decisions…" : <>Saved decisions are unavailable. <button type="button" onClick={needsChanged}>Retry</button></>}
    </p> : null}
    <NeedsYouList items={needs.items} roster={fullRoster} now={now} onUpdate={needs.update} onOpen={open} seen={needs.seen} />
    <button type="button" className="crew-button" onClick={() => { navigate.toPluginPanel("crew"); onNavigate(); }}>Open Crew workspace</button>
    <section className="radar-crew-roster" aria-label="Crew">
      <h3 className="radar-crew-section-head">Crew <small>{liveWorkers ? `${liveWorkers} worker${liveWorkers === 1 ? "" : "s"} live` : null}</small>
        {fullRoster.length ? <button type="button" className="radar-crew-visibility-toggle" aria-label="Bot visibility" title="Choose which bots are shown" aria-expanded={visibilityOpen} onClick={() => setVisibilityOpen(value => !value)}><Icon name="EyeOff" /></button> : null}
      </h3>
      {visibilityOpen ? <div className="radar-crew-visibility" role="group" aria-label="Bot visibility">
        {fullRoster.map(bot => <label key={bot.key}><input type="checkbox" checked={!visibility.isHidden(bot.key)} onChange={event => event.target.checked ? visibility.unhide(bot.key) : visibility.hide(bot.key)} /><span>Show {shortBotName(bot.name)}</span></label>)}
        <p>Bots that need you remain visible.</p>
      </div> : null}
      {rows.length ? <ol>{rows.map(renderMate)}</ol> : <p className="radar-crew-empty" role="status">{needs.items === null ? "No live bot activity." : needs.items.length ? "No work in progress." : "All quiet: nothing needs you."}</p>}
    </section>
    <section className="radar-crew-day" aria-label="Today's work">
      <h3 className="radar-crew-section-head">Today <small>{feed.length} jobs{running ? ` · ${running} running` : ""}{failed ? ` · ${failed} failed` : ""}</small></h3>
      {feed.length ? <>
        <ol className="radar-crew-jobs">{(feedOpen ? feed : feed.slice(0, FEED_PREVIEW)).map(renderJob)}</ol>
        {feed.length > FEED_PREVIEW ? <button type="button" className="radar-crew-day-more" aria-expanded={feedOpen} onClick={() => setFeedOpen(value => !value)}>{feedOpen ? "Show less" : `Show all ${feed.length} jobs`}</button> : null}
      </> : <p className="radar-crew-empty">No jobs today.</p>}
    </section>
  </div>;
}
