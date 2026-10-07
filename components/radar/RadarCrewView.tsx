import { useMemo, useState, type CSSProperties } from "react";
import { experimental_useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./BotAvatar";
import { botStyle, shortBotName, type RosterBot } from "./bots";
import { rosterRefreshKey } from "./botScope";
import { arrangeCrew, crewChapters, crewFeed, crewRow, jobsByBot, shortAgo, type CrewChapter, type CrewFeedItem, type CrewRow } from "./crew";
import { useCrewArchivedJobs, useCrewAutomations, useCrewJudgements } from "./useCrewData";
import { useThreadPulses } from "./useThreadPulses";

const ACTION: Partial<Record<CrewRow["line"]["tone"], string>> = { ask: "Reply", failed: "Check" };
const BADGE: Partial<Record<CrewRow["line"]["tone"], string>> = { ask: "?", failed: "!" };
const CHAPTER_PREVIEW = 6;
const JOBS_PER_CHAPTER = 3;

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function hue(bot: RosterBot): CSSProperties {
  return { "--bot-hue": botStyle(bot.key, bot.name).hue } as CSSProperties;
}

/**
 * The crew as a group chat: each bot with something to say speaks in a bubble,
 * most urgent first; the rest sit below as quiet one-line rows; then today's
 * feed of every job the crew ran. Tapping anything opens what it is about.
 */
export function RadarCrewView({ roster, now, onNavigate }: {
  roster: readonly RosterBot[];
  now: number;
  onNavigate: () => void;
}) {
  const { threads } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const coordinators = useMemo(
    () => threads.filter((thread) => roster.some((bot) => bot.current === thread.id)),
    [threads, roster],
  );
  const pulses = useThreadPulses(coordinators, true);
  const automations = useCrewAutomations();
  const judgements = useCrewJudgements(coordinators);
  const { speaking, resting } = useMemo(
    () => arrangeCrew(roster.map((bot) => crewRow({
      bot, threads, pulse: pulses.get(bot.current) ?? null, judgement: judgements.get(bot.current) ?? null, automations, now,
    }))),
    [roster, threads, pulses, judgements, automations, now],
  );
  const refreshKey = useMemo(() => rosterRefreshKey(threads), [threads]);
  const archived = useCrewArchivedJobs(useMemo(() => roster.map((bot) => bot.current), [roster]), refreshKey);
  const feed = useMemo(() => crewFeed({ roster, threads, archived, now }), [roster, threads, archived, now]);
  const chapters = useMemo(() => crewChapters(feed), [feed]);
  const jobCounts = useMemo(() => jobsByBot(feed), [feed]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [openChapters, setOpenChapters] = useState<ReadonlySet<string>>(() => new Set());
  const open = (threadId: string) => {
    navigate.toThread(threadId);
    onNavigate();
  };

  const renderBubble = (row: CrewRow) => {
    const { bot, line } = row;
    const name = shortBotName(bot.name);
    const action = ACTION[line.tone];
    const badge = BADGE[line.tone];
    return (
      <li key={bot.key} className={cn("radar-crew-say", `radar-crew-say-${line.tone}`)} style={hue(bot)} data-bot={bot.key}>
        <button
          type="button"
          className="radar-crew-say-button"
          aria-label={`${name}: ${line.tone === "running" ? `working on ${line.text}` : line.text}${row.more > 0 ? `, and ${row.more} more` : ""}`}
          onClick={() => open(line.threadId)}
        >
          <span className="radar-crew-speaker">
            <BotAvatar emoji={botStyle(bot.key, bot.name).emoji} context={row.context} />
            {badge ? <span className="radar-crew-badge" aria-hidden="true">{badge}</span> : null}
            {line.tone === "running" ? <span className="radar-crew-badge radar-crew-badge-busy" aria-hidden="true" /> : null}
          </span>
          <span className="radar-crew-bubble">
            <span className="radar-crew-bubble-head">
              <span className="radar-crew-sender">{name}</span>
              {line.tone === "new" ? <span className="radar-unread" aria-hidden="true" /> : null}
              {line.at !== null ? <span className="radar-crew-when">{shortAgo(line.at, now)}</span> : null}
            </span>
            <span className="radar-crew-text">
              {line.tone === "running" ? (
                <span className="radar-crew-typing" aria-hidden="true"><i /><i /><i /></span>
              ) : null}
              {line.text}
            </span>
            {row.more > 0 || action ? (
              <span className="radar-crew-bubble-foot">
                {row.more > 0 ? <span className="radar-crew-more">+{row.more} more</span> : null}
                {action ? <span className="radar-crew-action" aria-hidden="true">{action} ›</span> : null}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  const renderJob = (item: CrewFeedItem) => (
    <li key={item.id}>
      <button
        type="button"
        className={cn("radar-crew-job", `radar-crew-job-${item.state}`)}
        aria-label={`${item.title}, ${item.state}, started ${clockFormatter.format(item.startedAt)}`}
        onClick={() => open(item.id)}
      >
        <span className="radar-crew-job-mark" aria-hidden="true">
          {item.state === "running" ? <span className="radar-crew-job-spin" /> : item.state === "failed" ? "✕" : "✓"}
        </span>
        <span className="radar-crew-job-title">{item.title}</span>
      </button>
    </li>
  );

  const renderChapter = (chapter: CrewChapter) => {
    const expanded = openChapters.has(chapter.id);
    const shown = expanded ? chapter.items : chapter.items.slice(0, JOBS_PER_CHAPTER);
    const hidden = chapter.items.length - shown.length;
    const range = chapter.from === chapter.to
      ? clockFormatter.format(chapter.to)
      : `${clockFormatter.format(chapter.from)}–${clockFormatter.format(chapter.to)}`;
    return (
      <li key={chapter.id} className={cn("radar-crew-chapter", chapter.running > 0 && "radar-crew-chapter-live")} style={hue(chapter.bot)}>
        <span className="radar-crew-node" aria-hidden="true">{botStyle(chapter.bot.key, chapter.bot.name).emoji}</span>
        <div className="radar-crew-card">
          <div className="radar-crew-card-head">
            <span className="radar-crew-card-bot">{shortBotName(chapter.bot.name)}</span>
            <span className="radar-crew-card-range">{range}</span>
          </div>
          {chapter.items.length > 1 ? <div className="radar-crew-card-tally" aria-label={`${chapter.items.length} ${chapter.items.length === 1 ? "job" : "jobs"}: ${chapter.done} done, ${chapter.failed} failed, ${chapter.running} running`}>
            {chapter.running > 0 ? <span className="radar-crew-tally radar-crew-tally-running">{chapter.running} running</span> : null}
            {chapter.done > 0 ? <span className="radar-crew-tally radar-crew-tally-done">{chapter.done} done</span> : null}
            {chapter.failed > 0 ? <span className="radar-crew-tally radar-crew-tally-failed">{chapter.failed} failed</span> : null}
          </div> : null}
          <ul className="radar-crew-jobs">{shown.map(renderJob)}</ul>
          {hidden > 0 || expanded && chapter.items.length > JOBS_PER_CHAPTER ? (
            <button
              type="button"
              className="radar-crew-card-more"
              onClick={() => setOpenChapters((previous) => {
                const next = new Set(previous);
                if (next.has(chapter.id)) next.delete(chapter.id);
                else next.add(chapter.id);
                return next;
              })}
            >
              {expanded ? "Show less" : `+${hidden} more`}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="radar-crew-view">
      {speaking.length > 0 ? (
        <ol className="radar-crew-feed" aria-label="What your bots are saying">{speaking.map(renderBubble)}</ol>
      ) : (
        <p className="radar-crew-calm" role="status">
          <span className="radar-crew-calm-moon" aria-hidden="true">🌙</span>
          All quiet: nothing needs you.
        </p>
      )}
      {resting.length > 0 ? (
        <section className="radar-crew-bench" aria-label="Resting">
          <h3 className="radar-crew-label"><span aria-hidden="true">💤</span> Resting</h3>
          <div className="radar-crew-tiles" style={{ "--cols": resting.length === 4 ? 2 : Math.min(resting.length, 3) } as CSSProperties}>
            {resting.map((row) => {
              const jobs = jobCounts.get(row.bot.key) ?? 0;
              const name = shortBotName(row.bot.name);
              const ago = row.line.at !== null ? shortAgo(row.line.at, now) : null;
              return (
                <button
                  key={row.bot.key}
                  type="button"
                  className="radar-crew-tile"
                  style={hue(row.bot)}
                  title={row.line.text}
                  aria-label={`Open ${row.bot.name}, resting${ago ? `, last reply ${ago} ago` : ""}, ${jobs} ${jobs === 1 ? "job" : "jobs"} today: ${row.line.text}`}
                  onClick={() => open(row.bot.current)}
                >
                  <span className="radar-crew-tile-face">
                    <BotAvatar emoji={botStyle(row.bot.key, row.bot.name).emoji} context={row.context} />
                  </span>
                  <span className="radar-crew-tile-name">{name}</span>
                  <span className="radar-crew-tile-meta">
                    {ago ? <span>{ago}</span> : null}
                    <span className={cn(jobs > 0 && "radar-crew-tile-busy")}>{jobs > 0 ? `${jobs} ${jobs === 1 ? "job" : "jobs"}` : "idle"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      <section className="radar-crew-day" aria-label="Today">
        <h3 className="radar-crew-label">
          <span aria-hidden="true">☀️</span> Today
          {feed.length > 0 ? <span className="radar-crew-label-count">{feed.length} {feed.length === 1 ? "job" : "jobs"}</span> : null}
        </h3>
        {feed.length === 0 ? (
          <p className="radar-crew-day-empty">No jobs yet today.</p>
        ) : (
          <ol className="radar-crew-story">
            {(feedOpen ? chapters : chapters.slice(0, CHAPTER_PREVIEW)).map((chapter) => renderChapter(chapter))}
          </ol>
        )}
        {chapters.length > CHAPTER_PREVIEW ? (
          <button type="button" className="radar-crew-day-more" onClick={() => setFeedOpen((value) => !value)}>
            {feedOpen ? "Show less" : `Show the whole day (${feed.length} jobs)`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
