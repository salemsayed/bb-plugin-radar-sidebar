import { useEffect, useState } from "react";
import { BotAvatar } from "@/components/radar/BotAvatar";
import { BotFace } from "@/components/radar/BotFace";
import { StageFace, type StagePose } from "@/components/radar/StageFace";
import type { BotState } from "@/components/radar/bots";
import { BOTS } from "./build";

const CREW = [...BOTS, { key: "atlas", name: "Atlas Bot" }];
const POSES: StagePose[] = ["idle", "working", "asking", "waiting", "checking", "blocked", "done", "unread", "offline"];
const POSE_WORDS: Record<StagePose, string> = { idle: "Idle", working: "Working", asking: "Waiting on you", waiting: "Waiting", checking: "Checking", blocked: "Stuck", done: "Done", unread: "New reply", offline: "Machine off" };
const SMALL = [14, 16, 20, 24, 32];
const LARGE = [30, 48, 64, 88];
const AVATAR_STATES: BotState[] = ["idle", "working", "rollover", "needs-you", "decision", "failed", "updates", "unread", "unavailable"];
const LIVE_CYCLE: StagePose[] = ["idle", "working", "working", "asking", "working", "done", "idle", "blocked", "waiting", "offline"];
const LIVE_STEP_MS = 2400;

function Live() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), LIVE_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  return <div className="gallery-live">{CREW.slice(0, 10).map((bot, index) => {
    const pose = LIVE_CYCLE[(tick + index * 3) % LIVE_CYCLE.length]!;
    return <figure key={bot.key}><StageFace botKey={bot.key} name={bot.name} pose={pose} size={88} /><figcaption>{bot.name.replace(/ Bot$/, "")}<span>{POSE_WORDS[pose]}</span></figcaption></figure>;
  })}</div>;
}

function Avatars() {
  return <section>
    <h2>Rail avatars</h2>
    <table className="gallery-grid">
      <thead><tr><th />{AVATAR_STATES.map(state => <th key={state}>{state}</th>)}</tr></thead>
      <tbody>{CREW.slice(0, 4).map(bot => <tr key={bot.key}><th>{bot.name.replace(/ Bot$/, "")}</th>{AVATAR_STATES.map(state => <td key={state}><BotAvatar botKey={bot.key} name={bot.name} state={state} /></td>)}</tr>)}</tbody>
    </table>
  </section>;
}

export function Gallery({ part }: { part: string }) {
  if (part === "live") return <main className="gallery" data-bb-plugin="radar-sidebar"><Live /></main>;
  if (part === "avatars") return <main className="gallery" data-bb-plugin="radar-sidebar"><Avatars /></main>;
  return <main className="gallery" data-bb-plugin="radar-sidebar">
    <section>
      <h2>The crew</h2>
      <div className="gallery-crew">{CREW.map(bot => <figure key={bot.key}><StageFace botKey={bot.key} name={bot.name} pose="idle" size={88} /><figcaption>{bot.name.replace(/ Bot$/, "")}</figcaption></figure>)}</div>
    </section>
    <section>
      <h2>Every state</h2>
      <table className="gallery-grid">
        <thead><tr><th />{POSES.map(pose => <th key={pose}>{POSE_WORDS[pose]}</th>)}</tr></thead>
        <tbody>{CREW.map(bot => <tr key={bot.key}><th>{bot.name.replace(/ Bot$/, "")}</th>{POSES.map(pose => <td key={pose}><StageFace botKey={bot.key} name={bot.name} pose={pose} size={48} /></td>)}</tr>)}</tbody>
      </table>
    </section>
    <section>
      <h2>Every size</h2>
      <table className="gallery-grid gallery-sizes">
        <thead><tr><th />{SMALL.map(size => <th key={size}>{size}</th>)}{LARGE.map(size => <th key={size}>{size}</th>)}</tr></thead>
        <tbody>{CREW.map(bot => <tr key={bot.key}><th>{bot.name.replace(/ Bot$/, "")}</th>
          {SMALL.map(size => <td key={size}><BotFace botKey={bot.key} name={bot.name} size={size} /></td>)}
          {LARGE.map(size => <td key={size}><StageFace botKey={bot.key} name={bot.name} pose="idle" size={size} bare /></td>)}
        </tr>)}</tbody>
      </table>
    </section>
    <Avatars />
  </main>;
}
