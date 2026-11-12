import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/bb.css";
import "../../app.css";
import "./harness.css";
import { BotDeskMenuProvider } from "@/components/radar/BotDeskMenu";
import { BotPanelTab } from "@/components/radar/BotPanelTab";
import { BotsView } from "@/components/radar/BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { BOTS, buildWorld, coordinator } from "./build";
import { NOW, freezeClock } from "./clock";
import { SCENARIOS, type Scenario } from "./scenarios";
import { currentWorld, setWorld } from "./world";

type View = "desktop" | "phone";
const PHONE_MAX_WIDTH = 640;

function readParams() {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  return {
    scenario: SCENARIOS.find(item => item.id === params.get("s")) ?? null,
    view: (view === "phone" || view === "desktop" ? view : window.innerWidth <= PHONE_MAX_WIDTH ? "phone" : "desktop") as View,
    dark: params.get("theme") === "dark",
    tab: params.get("surface") === "tab",
  };
}

function href(id: string, view: View, dark: boolean): string {
  return `?s=${id}&view=${view}${dark ? "&theme=dark" : ""}`;
}

function Index() {
  return <main className="harness-index">
    <h1>Radar bot panel scenarios</h1>
    <p>Each scenario renders the real panel with fixture data. Clock frozen at Thu 12 Nov 2026, 13:40 Cairo.</p>
    <ol>{SCENARIOS.map(item => <li key={item.id}>
      <b>{item.title}</b>
      <span>{item.look}</span>
      <nav>
        <a href={href(item.id, "desktop", false)}>Desktop</a>
        <a href={href(item.id, "phone", false)}>Phone</a>
        <a href={href(item.id, "desktop", true)}>Desktop dark</a>
        <a href={href(item.id, "phone", true)}>Phone dark</a>
        <a href={`${href(item.id, "desktop", false)}&surface=tab`}>Bot tab</a>
      </nav>
    </li>)}</ol>
  </main>;
}

function openPanel(botKey: string): boolean {
  const more = document.querySelector<HTMLElement>(`.stage-row[data-bot="${botKey}"] .stage-more`);
  if (!more) return false;
  more.click();
  return true;
}

const SETTLE_MS = 900;

function Stage({ scenario, view, tab }: { scenario: Scenario; view: View; tab: boolean }) {
  const panel = !tab;
  const data = useMemo(() => botTasksSchema.parse(currentWorld().tasks), []);
  const state = useMemo(() => ({ data, status: "ready" as const, cached: false }), [data]);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const onAction = (event: Event) => setLog(lines => [...lines.slice(-4), String((event as CustomEvent<string>).detail)]);
    window.addEventListener("harness:action", onAction);
    return () => window.removeEventListener("harness:action", onAction);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    const settle = () => {
      if (cancelled) return;
      const open = !panel || !!document.querySelector(".dispatch-panel") || openPanel(scenario.sketch.focus);
      const scanned = currentWorld().calls.some(call => call.method === "threads.list") && performance.now() - started > SETTLE_MS;
      if (open && scanned) { void document.fonts.ready.then(() => requestAnimationFrame(() => { document.documentElement.dataset.harnessReady = "true"; })); return; }
      setTimeout(settle, 60);
    };
    settle();
    return () => { cancelled = true; };
  }, [scenario, panel]);
  const act = (text: string) => window.dispatchEvent(new CustomEvent("harness:action", { detail: text }));
  const board = <div className="radar-list-shell" data-radar-mode="bots"><div className={`radar-list radar-bots-list${view === "phone" ? " radar-list-compact" : ""}`}><div className="radar-list-body">
    <BotDeskMenuProvider>
      <BotsView state={state} activeThreadId={null} isCompactViewport={view === "phone"} now={NOW}
        onOpen={(threadId, seq) => act(`open ${threadId}${seq === undefined ? "" : ` at message ${seq}`}`)} onShowThreads={() => act("show all threads")} />
    </BotDeskMenuProvider>
  </div></div></div>;
  if (tab) return <div className="harness-app" data-view={view} data-bb-plugin="radar-sidebar">
    {view === "desktop" ? <aside className="harness-sidebar">{board}</aside> : null}
    <section className="harness-tab"><BotPanelTab threadId={coordinator(scenario.sketch.focus)} /></section>
  </div>;
  return <div className="harness-app" data-view={view} data-bb-plugin="radar-sidebar">
    {view === "desktop" ? <div className="harness-rail" aria-hidden="true" /> : null}
    <aside className="harness-sidebar">{board}</aside>
    {view === "desktop" ? <section className="harness-main">
      <a href="?">All scenarios</a>
      <h1>{scenario.title}</h1>
      <p>{scenario.look}</p>
      <p className="harness-bot">{BOTS.find(bot => bot.key === scenario.sketch.focus)?.name} · {scenario.id}</p>
      {log.length ? <ul className="harness-log">{log.map((line, i) => <li key={i}>{line}</li>)}</ul> : null}
    </section> : null}
  </div>;
}

function App() {
  const { scenario, view, dark, tab } = readParams();
  document.documentElement.classList.toggle("dark", dark);
  if (!scenario) return <Index />;
  return <Stage scenario={scenario} view={view} tab={tab} />;
}

freezeClock();
localStorage.clear();
const chosen = readParams().scenario;
if (chosen) setWorld(buildWorld(chosen.sketch));
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
